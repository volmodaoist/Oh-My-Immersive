import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { request } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const output = await build({
  stdin: { contents: 'export * from "./src/ink/protocol"; export * from "./src/ink/engine"; export * from "./src/ink/server";', resolveDir: process.cwd(), loader: "ts" },
  platform: "node", format: "cjs", bundle: true, write: false, external: ["remote-ink-client"],
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require: name => name === "remote-ink-client" ? "// browser client" : require(name), URL, Buffer });
const { InkStore, parseOp, acceptsPointer, pressureOf, normalizedPoint, hitStroke, InkPainter, InkServer } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const stroke = (id = "s1", owner = "c1") => ({ id, owner, tool: "pen", color: "#df3a45", size: 3, points: [[0.1, 0.2, 0.55]], complete: false });

test("Pencil and left mouse start strokes; touch, palms and right mouse do not", () => {
  const input = { pointerType: "pen", button: 0, buttons: 1, pressure: 0.7 };
  assert.equal(acceptsPointer(input), true);
  assert.equal(acceptsPointer({ ...input, pointerType: "mouse" }), true);
  assert.equal(acceptsPointer({ ...input, pointerType: "touch" }), false);
  assert.equal(acceptsPointer({ ...input, pointerType: "mouse", button: 2 }), false);
  assert.equal(pressureOf(input), 0.7);
  assert.equal(pressureOf({ ...input, pointerType: "mouse", pressure: 0 }), 0.55);
});

test("normalized coordinates preserve the same point across different view sizes", () => {
  assert.deepEqual(plain(normalizedPoint(320, 200, { left: 0, top: 0, width: 1280, height: 800 }, 0.8)), [0.25, 0.25, 0.8]);
  assert.deepEqual(plain(normalizedPoint(180, 130, { left: 20, top: 30, width: 640, height: 400 }, 0.8)), [0.25, 0.25, 0.8]);
});

test("append operations are visible before end and finalize in session memory", () => {
  const store = new InkStore();
  store.apply(parseOp({ t: "begin", stroke: stroke() }));
  store.apply(parseOp({ t: "append", id: "s1", offset: 1, points: [[0.3, 0.4, 0.7], [0.5, 0.6, 0.9]] }));
  assert.equal(store.snapshot().strokes[0].points.length, 3);
  assert.equal(store.snapshot().strokes[0].complete, false);
  store.apply({ t: "end", id: "s1" });
  assert.equal(store.snapshot().strokes[0].complete, true);
  assert.equal(store.snapshot().strokes[0].points.length, 3);
});

test("duplicate batches do not duplicate points and missing batches are rejected", () => {
  const store = new InkStore();
  store.apply({ t: "begin", stroke: stroke() });
  const batch = { t: "append", id: "s1", offset: 1, points: [[0.2, 0.3, 0.6]] };
  assert.equal(store.apply(batch), true);
  assert.equal(store.apply(batch), false);
  assert.throws(() => store.apply({ ...batch, offset: 4 }));
  assert.equal(store.snapshot().strokes[0].points.length, 2);
});

test("cancel discards a stroke; deleting and clearing completed strokes update state", () => {
  const store = new InkStore();
  store.apply({ t: "begin", stroke: stroke() });
  store.apply({ t: "cancel", id: "s1" });
  assert.equal(store.strokes.size, 0);
  for (const id of ["a", "b"]) { store.apply({ t: "begin", stroke: stroke(id) }); store.apply({ t: "end", id }); }
  store.apply({ t: "delete", ids: ["a"] });
  assert.deepEqual(plain(store.snapshot().strokes.map(s => s.id)), ["b"]);
  store.apply({ t: "clear" });
  assert.equal(store.snapshot().strokes.length, 0);
});

test("invalid coordinates, colors and oversized point batches are rejected", () => {
  for (const invalid of [
    { t: "begin", stroke: { ...stroke(), color: "url(javascript:bad)" } },
    { t: "append", id: "s1", offset: 1, points: [[Infinity, 0, 0.5]] },
    { t: "append", id: "s1", offset: 1, points: [[0, 0, -1]] },
    { t: "append", id: "s1", offset: 1, points: Array(2049).fill([0, 0, 0.5]) },
  ]) assert.throws(() => parseOp(invalid));
});

test("eraser hits the middle of a sparsely sampled segment", () => {
  const s = { ...stroke(), points: [[0, 0, 0.5], [1, 1, 0.5]] };
  assert.equal(hitStroke(s, [0.5, 0.5, 0.5], 1000, 1000), true);
  assert.equal(hitStroke(s, [0.1, 0.9, 0.5], 1000, 1000), false);
});

test("compositing unfinished ink retains all earlier stroke segments", () => {
  const contexts = [];
  const makeCanvas = () => {
    const ctx = {
      segments: [], position: null, setTransform() {}, drawImage() {}, beginPath() {}, arc() {}, fill() {},
      clearRect() { this.segments = []; },
      moveTo(x, y) { this.position = [x, y]; },
      lineTo(x, y) { this.next = [x, y]; },
      stroke() { this.segments.push([this.position, this.next]); },
    };
    contexts.push(ctx);
    return { ownerDocument: doc, getContext: () => ctx };
  };
  const doc = { createElement: () => makeCanvas(), defaultView: { devicePixelRatio: 1 } };
  const painter = new InkPainter(makeCanvas());
  painter.resize(1000, 1000);
  const s = stroke();
  s.points.push([0.3, 0.4, 0.6]); painter.live(s);
  s.points.push([0.5, 0.6, 0.7]); painter.live(s);
  assert.equal(contexts[2].segments.length, 2);
  assert.deepEqual(plain(contexts[2].segments[0]), [[100, 200], [300, 400]]);
});

test("HTTP and SSE broadcast incremental ink before pointer-up", async t => {
  const server = new InkServer({ frame: async () => Buffer.from("test frame") });
  await server.start(0);
  const base = `http://127.0.0.1:${server.port}`;
  const suffix = `?code=${server.code}`;
  const abort = new AbortController();
  const response = await fetch(base + "/events" + suffix, { signal: abort.signal });
  const reader = response.body.getReader();
  t.after(async () => { abort.abort(); await reader.cancel().catch(() => {}); await server.stop(); });
  let pending = "";
  const next = async () => {
    while (!pending.includes("\n\n")) {
      const { value } = await reader.read();
      pending += new TextDecoder().decode(value);
    }
    const index = pending.indexOf("\n\n"), raw = pending.slice(0, index);
    pending = pending.slice(index + 2);
    return { event: raw.match(/^event: (.+)$/m)[1], data: JSON.parse(raw.match(/^data: (.+)$/m)[1]) };
  };
  assert.equal((await next()).event, "snapshot");
  const post = op => fetch(base + "/api/op" + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op) });
  assert.equal((await post({ t: "begin", stroke: stroke() })).status, 200);
  assert.equal((await next()).data.op.t, "begin");
  assert.equal((await post({ t: "append", id: "s1", offset: 1, points: [[0.4, 0.5, 0.6]] })).status, 200);
  assert.equal((await next()).data.op.t, "append");
  const state = await (await fetch(base + "/api/state" + suffix)).json();
  assert.equal(state.strokes[0].complete, false);
  assert.equal(state.strokes[0].points.length, 2);
  assert.equal((await post({ t: "end", id: "s1" })).status, 200);
  assert.equal((await next()).data.op.t, "end");
  assert.equal(server.store.snapshot().strokes[0].complete, true);
  server.clear();
  assert.equal((await next()).data.op.t, "clear");
  assert.equal((await (await fetch(base + "/api/state" + suffix)).json()).strokes.length, 0);
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal((await post({ t: "append", id: "missing", offset: 1, points: [[0, 0, 0.5]] })).status, 400);
  assert.equal((await fetch(base + "/api/state" + suffix, { headers: { Origin: "http://different-host" } })).status, 403);
});

test("stopping the service clears temporary ink and a new service starts empty", async () => {
  const host = { frame: async () => Buffer.from("test frame") };
  const server = new InkServer(host);
  await server.start(0);
  server.store.apply({ t: "begin", stroke: stroke() });
  server.store.apply({ t: "end", id: "s1" });
  assert.equal(server.store.strokes.size, 1);
  await server.stop();
  assert.equal(server.store.strokes.size, 0);
  const next = new InkServer(host);
  await next.start(0);
  assert.equal(next.store.snapshot().strokes.length, 0);
  await next.stop();
});

async function stopPromptly(server) {
  let timer;
  try {
    await Promise.race([
      server.stop(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stop waited for an unfinished browser request")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("stopping closes connected viewers and unfinished frame requests, releasing the port", { timeout: 5000 }, async t => {
  let enteredFrame;
  let finishFrame;
  const entered = new Promise(resolve => { enteredFrame = resolve; });
  const frame = new Promise(resolve => { finishFrame = resolve; });
  const server = new InkServer({ frame: () => { enteredFrame(); return frame; } });
  await server.start(0);
  const port = server.port;
  const base = `http://127.0.0.1:${port}`;
  const suffix = `?code=${server.code}`;
  const frameAbort = new AbortController();
  const streamAbort = new AbortController();
  let frameRequest;
  t.after(async () => {
    frameAbort.abort();
    streamAbort.abort();
    finishFrame(Buffer.from("late frame"));
    await frameRequest;
    await server.stop();
  });
  const response = await fetch(base + "/events" + suffix, { signal: streamAbort.signal });
  await response.body.getReader().read();
  frameRequest = fetch(base + "/frame" + suffix, { signal: frameAbort.signal }).catch(() => null);
  await entered;
  server.store.apply({ t: "begin", stroke: stroke() });

  // The capture deliberately stays pending until teardown; clients do not disconnect first.
  await stopPromptly(server);
  assert.equal(server.store.strokes.size, 0);
  await frameRequest;
  const next = new InkServer({ frame: async () => Buffer.from("new frame") });
  await next.start(port);
  t.after(() => next.stop());
  assert.equal(next.store.strokes.size, 0);
  await server.stop();
  await next.stop();
});

test("stopping closes unfinished uploads and connections that have not sent headers", { timeout: 5000 }, async t => {
  const server = new InkServer({ frame: async () => Buffer.from("test frame") });
  await server.start(0);
  const upload = request(`http://127.0.0.1:${server.port}/api/op?code=${server.code}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "4096" },
  });
  upload.on("error", () => {});
  const uploadClosed = new Promise(resolve => upload.once("close", resolve));
  const idle = connect(server.port, "127.0.0.1");
  idle.on("error", () => {});
  const idleClosed = new Promise(resolve => idle.once("close", resolve));
  t.after(async () => {
    upload.destroy();
    idle.destroy();
    await server.stop();
  });
  upload.write('{"t":"clear"');
  await once(idle, "connect");
  const state = await fetch(`http://127.0.0.1:${server.port}/api/state?code=${server.code}`);
  assert.equal(state.status, 200);
  await state.json();

  // Neither client completes its request; stopping must close both sockets.
  await stopPromptly(server);
  await Promise.all([uploadClosed, idleClosed]);
  assert.equal(server.store.strokes.size, 0);
});

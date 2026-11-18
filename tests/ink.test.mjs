import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
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

test("append operations are visible before end but incomplete ink is not saved", () => {
  const store = new InkStore();
  store.apply(parseOp({ t: "begin", stroke: stroke() }));
  store.apply(parseOp({ t: "append", id: "s1", offset: 1, points: [[0.3, 0.4, 0.7], [0.5, 0.6, 0.9]] }));
  assert.equal(store.snapshot().strokes[0].points.length, 3);
  assert.equal(store.snapshot().strokes[0].complete, false);
  assert.equal(store.saved().length, 0);
  store.apply({ t: "end", id: "s1" });
  const restored = new InkStore();
  restored.restore(plain(store.saved()));
  assert.deepEqual(plain(restored.saved()), plain(store.saved()));
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

test("cancel discards a stroke; deleting and clearing saved strokes update state", () => {
  const store = new InkStore();
  store.apply({ t: "begin", stroke: stroke() });
  store.apply({ t: "cancel", id: "s1" });
  assert.equal(store.strokes.size, 0);
  for (const id of ["a", "b"]) { store.apply({ t: "begin", stroke: stroke(id) }); store.apply({ t: "end", id }); }
  store.apply({ t: "delete", ids: ["a"] });
  assert.deepEqual(plain(store.saved().map(s => s.id)), ["b"]);
  store.apply({ t: "clear" });
  assert.equal(store.saved().length, 0);
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
  const saved = [];
  const server = new InkServer({ frame: async () => Buffer.from("test frame"), save: strokes => saved.push(plain(strokes)) });
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
  assert.equal(saved.length, 0);
  assert.equal((await post({ t: "end", id: "s1" })).status, 200);
  assert.equal(saved[0][0].points.length, 2);
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal((await post({ t: "append", id: "missing", offset: 1, points: [[0, 0, 0.5]] })).status, 400);
  assert.equal((await fetch(base + "/api/state" + suffix, { headers: { Origin: "http://different-host" } })).status, 403);
});

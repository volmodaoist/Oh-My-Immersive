import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const output = await build({
  stdin: {
    contents: 'export * from "./src/ink/scroll"; export * from "./src/ink/scroll-host"; export * from "./src/ink/enums"; export * from "./src/ink/server";',
    resolveDir: process.cwd(), loader: "ts",
  },
  platform: "node", format: "cjs", bundle: true, write: false,
  external: ["remote-ink-client"],
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, {
  module, exports: module.exports, URL, Buffer,
  require: name => name === "remote-ink-client" ? "// client" : require(name),
});
const { parseScrollRequest, wheelScrollAmount, MarkdownScrollHost, InkServer, ScrollResult } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

function view(mode = "preview") {
  const container = () => ({ isConnected: true, clientHeight: 800, scrollHeight: 3200, scrollTop: 400, scrollLeft: 17 });
  const preview = container();
  const source = container();
  const calls = [];
  return {
    mode, preview, source, calls, file: { path: "note.md" },
    getMode() { return this.mode; },
    containerEl: { querySelector: () => source },
    previewMode: { containerEl: preview },
    editor: {
      getScrollInfo: () => ({ top: source.scrollTop, left: source.scrollLeft }),
      scrollTo: (left, top) => { calls.push([left, top]); source.scrollTop = top; },
    },
  };
}

test("scroll input validates bounds and strips extra fields", () => {
  assert.deepEqual(plain(parseScrollRequest({ target: "v1", amount: -0.5, ignored: true })), { target: "v1", amount: -0.5 });
  for (const input of [null, [], {}, { target: "note.md", amount: 0.5 }, { target: "v1", amount: "1" },
    { target: "v1", amount: 0 }, { target: "v1", amount: 1.1 }, { target: "v1", amount: -2 }, { target: "v1", amount: Infinity }]) {
    assert.throws(() => parseScrollRequest(input));
  }
});

test("pixel, line and page wheel input share viewport units and bounded amounts", () => {
  assert.equal(wheelScrollAmount(80, 0, 800), 0.1);
  assert.equal(wheelScrollAmount(-5, 1, 800), -0.1);
  assert.equal(wheelScrollAmount(1, 2, 800), 1);
  assert.equal(wheelScrollAmount(-99999, 0, 800), -1);
  assert.equal(wheelScrollAmount(5, 0, 0), 0);
  assert.equal(wheelScrollAmount(Infinity, 0, 800), 0);
  assert.equal(wheelScrollAmount(80, 3, 800), 0);
});

test("reading mode scrolls vertically by viewport fractions and clamps both ends", () => {
  const note = view();
  const host = new MarkdownScrollHost(() => note);
  const { target } = host.getState();
  assert.equal(host.scroll({ target, amount: 0.5 }), ScrollResult.Applied);
  assert.equal(note.preview.scrollTop, 800);
  assert.equal(host.getState().target, target);
  note.preview.scrollTop = 2300;
  host.scroll({ target, amount: 1 });
  assert.equal(note.preview.scrollTop, 2400);
  note.preview.scrollTop = 50;
  host.scroll({ target, amount: -0.5 });
  assert.equal(note.preview.scrollTop, 0);
  assert.equal(note.preview.scrollLeft, 17);
  assert.equal(note.calls.length, 0);
});

test("editing mode uses the editor scroll API while preserving horizontal position", () => {
  const note = view("source");
  const host = new MarkdownScrollHost(() => note);
  host.scroll({ target: host.getState().target, amount: -0.25 });
  assert.deepEqual(note.calls, [[null, 200]]);
  assert.equal(note.source.scrollLeft, 17);
  assert.equal(note.preview.scrollTop, 400);
});

test("stale commands cannot scroll a switched file, mode or pane", () => {
  let note = view();
  const host = new MarkdownScrollHost(() => note);
  let target = host.getState().target;
  note.file.path = "another.md";
  assert.equal(host.scroll({ target, amount: 0.5 }), ScrollResult.Stale);
  assert.equal(note.preview.scrollTop, 400);
  target = host.getState().target;
  note.mode = "source";
  assert.equal(host.scroll({ target, amount: 0.5 }), ScrollResult.Stale);
  assert.equal(note.source.scrollTop, 400);
  target = host.getState().target;
  note = view();
  assert.equal(host.scroll({ target, amount: 0.5 }), ScrollResult.Stale);
  assert.equal(note.preview.scrollTop, 400);
});

test("missing notes and disconnected scroll containers return unavailable", () => {
  let note = null;
  const host = new MarkdownScrollHost(() => note);
  assert.equal(host.getState().target, null);
  assert.equal(host.scroll({ target: "v1", amount: 0.5 }), ScrollResult.Unavailable);
  note = view();
  const target = host.getState().target;
  note.preview.isConnected = false;
  assert.equal(host.scroll({ target, amount: 0.5 }), ScrollResult.Unavailable);
  note.preview.isConnected = true;
  assert.notEqual(host.getState().target, target);
  note.preview.clientHeight = 0;
  assert.equal(host.getState().target, null);
});

test("scroll HTTP endpoint checks authentication, payload bounds and active writing", async t => {
  const note = view();
  const host = new MarkdownScrollHost(() => note);
  const server = new InkServer({ frame: async () => Buffer.from("frame"), scrollState: () => host.getState(), scroll: value => host.scroll(value) });
  await server.start(0);
  t.after(() => server.stop());
  const url = `http://127.0.0.1:${server.port}/api/scroll`;
  const authorized = `${url}?code=${server.code}`;
  const post = (body, endpoint = authorized, extraHeaders = {}) => fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(url)).status, 401);
  const { target } = await (await fetch(authorized)).json();
  const command = { target, amount: 0.5 };
  assert.equal((await post(command, url)).status, 401);
  assert.equal((await post(command, authorized, { Origin: "http://other-host" })).status, 403);
  assert.equal((await post({ ...command, amount: 100 })).status, 400);
  assert.equal((await post({ ...command, padding: "x".repeat(2000) })).status, 400);
  assert.equal((await post(command, authorized, { "Content-Type": "text/plain" })).status, 400);
  assert.equal(note.preview.scrollTop, 400);
  assert.equal((await (await post(command)).json()).result, ScrollResult.Applied);
  assert.equal(note.preview.scrollTop, 800);
  assert.equal(server.store.revision, 0);

  server.store.apply({ t: "begin", stroke: { id: "pen", owner: "other-client", tool: "pen", color: "#df3a45", size: 3, points: [[0.1, 0.2, 0.5]], complete: false } });
  assert.equal((await (await post(command)).json()).result, ScrollResult.Busy);
  assert.equal(note.preview.scrollTop, 800);
  server.store.apply({ t: "end", id: "pen" });
  const revision = server.store.revision;
  assert.equal((await (await post(command)).json()).result, ScrollResult.Applied);
  assert.equal(server.store.revision, revision);
  assert.equal(server.store.strokes.size, 1);

  note.file.path = "changed.md";
  const position = note.preview.scrollTop;
  assert.equal((await (await post(command)).json()).result, ScrollResult.Stale);
  assert.equal(note.preview.scrollTop, position);
});

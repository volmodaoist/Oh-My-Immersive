import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const output = await build({ entryPoints: ["src/ink/frames.ts"], bundle: true, write: false, platform: "node", format: "cjs" });
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, Uint8Array });
const { FramePainter } = module.exports;

function display() {
  const canvas = { ownerDocument: {}, width: 640, height: 480, pixels: null };
  const operations = [];
  canvas.getContext = () => ({ drawImage(source) { canvas.pixels = source.name; operations.push(`draw:${source.name}`); } });
  const frame = (name, width = 640, height = 480) => ({ source: { name }, width, height, release() { operations.push(`release:${name}`); } });
  return { canvas, operations, frame };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("the previous frame stays visible until a delayed replacement is decoded", async () => {
  const { canvas, frame, operations } = display();
  const next = deferred();
  const painter = new FramePainter(canvas, blob => blob === "first" ? Promise.resolve(frame("first")) : next.promise);
  await painter.show("first");
  const replacement = painter.show("second");
  assert.equal(canvas.pixels, "first");
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 480);
  next.resolve(frame("second", 1280, 720));
  await replacement;
  assert.equal(canvas.pixels, "second");
  assert.equal(canvas.width, 1280);
  assert.deepEqual(operations, ["draw:first", "release:first", "draw:second", "release:second"]);
});

test("a decoding failure preserves the displayed frame and its dimensions", async () => {
  const { canvas, frame } = display();
  const painter = new FramePainter(canvas, blob => blob === "first" ? Promise.resolve(frame("first")) : Promise.reject(new Error("bad image")));
  await painter.show("first");
  await assert.rejects(painter.show("bad"), /bad image/);
  assert.equal(canvas.pixels, "first");
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 480);
});

test("late older frames cannot overwrite a newer displayed frame", async () => {
  const { canvas, frame, operations } = display();
  const old = deferred();
  const painter = new FramePainter(canvas, blob => blob === "old" ? old.promise : Promise.resolve(frame("new")));
  const pending = painter.show("old");
  await painter.show("new");
  old.resolve(frame("old"));
  await pending;
  assert.equal(canvas.pixels, "new");
  assert.deepEqual(operations, ["draw:new", "release:new", "release:old"]);
});

test("disposing while decoding releases the image without touching the display", async () => {
  const { canvas, frame, operations } = display();
  const next = deferred();
  const painter = new FramePainter(canvas, () => next.promise);
  const pending = painter.show("frame");
  painter.destroy();
  next.resolve(frame("frame"));
  await pending;
  assert.equal(canvas.pixels, null);
  assert.deepEqual(operations, ["release:frame"]);
});

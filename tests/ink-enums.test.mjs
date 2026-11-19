import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const output = await build({ entryPoints: ["src/ink/enums.ts"], bundle: true, write: false, platform: "node", format: "cjs" });
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports });
const { DrawingTool, InkOperationType, InkStreamEvent, PointerType, parseDrawingTool, parseOperationType, parsePointerType } = module.exports;

test("shared enums keep the existing browser and SSE protocol values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify({ tool: DrawingTool.Pen, type: InkOperationType.Append, event: InkStreamEvent.Operation })), { tool: "pen", type: "append", event: "op" });
  assert.equal(InkStreamEvent.Snapshot, "snapshot");
  assert.equal(DrawingTool.Marker, "marker");
  assert.equal(DrawingTool.Eraser, "eraser");
});

test("enum input boundaries accept known strings and reject unexpected values", () => {
  assert.equal(parseDrawingTool("pen"), DrawingTool.Pen);
  assert.equal(parseOperationType("clear"), InkOperationType.Clear);
  assert.equal(parsePointerType("touch"), PointerType.Touch);
  for (const value of [null, {}, 42, "unexpected"]) {
    assert.equal(parseDrawingTool(value), null);
    assert.equal(parseOperationType(value), null);
    assert.equal(parsePointerType(value), null);
  }
});

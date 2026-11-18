import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const output = await build({ entryPoints: ["src/ink/gestures.ts"], platform: "node", format: "cjs", bundle: true, write: false });
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports });
const { protectDrawingSurface } = module.exports;

function surface() {
  const target = new EventTarget();
  target.selectionClears = 0;
  target.ownerDocument = { getSelection: () => ({ removeAllRanges: () => { target.selectionClears++; } }) };
  protectDrawingSurface(target);
  return target;
}

test("drawing surface cancels native long-press selection, menus and dragging", () => {
  const target = surface();
  for (const name of ["contextmenu", "selectstart", "dragstart"]) {
    const event = new Event(name, { cancelable: true });
    assert.equal(target.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
  }
});

test("ignored palm touches still cancel the browser's default gesture", () => {
  const target = surface();
  for (const name of ["touchstart", "touchmove", "touchend"]) {
    const event = new Event(name, { cancelable: true });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
});

test("pointer handlers still receive pen input while selection defaults are cancelled", () => {
  const target = surface();
  const delivered = [];
  target.addEventListener("pointerdown", event => { delivered.push(event.pointerType); });
  const event = new Event("pointerdown", { cancelable: true });
  event.pointerType = "pen";
  target.dispatchEvent(event);
  assert.deepEqual(delivered, ["pen"]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(target.selectionClears, 1);
});

test("controls outside the drawing surface retain native selection and touch defaults", () => {
  surface();
  const control = new EventTarget();
  for (const name of ["contextmenu", "selectstart", "touchstart"]) {
    const event = new Event(name, { cancelable: true });
    assert.equal(control.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
  }
});

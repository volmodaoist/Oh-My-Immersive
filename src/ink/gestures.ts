/** Keep drawing gestures out of browser selection, image drag and callout UI.
 * Capture listeners cancel defaults without stopping the ink pointer handlers.
 * The scope is the drawing surface, leaving form fields and controls alone. */
export function protectDrawingSurface(surface: HTMLElement): void {
  const preventDefault = (event: Event): void => {
    if (event.cancelable) {
      event.preventDefault();
    }
  };
  for (const name of ["contextmenu", "selectstart", "dragstart"]) {
    surface.addEventListener(name, preventDefault, { capture: true });
  }
  for (const name of ["touchstart", "touchmove", "touchend"]) {
    // Safari's touch defaults are separate from Pointer Events. In particular,
    // ignored palm input still needs its native long-press action cancelled.
    surface.addEventListener(name, preventDefault, {
      capture: true,
      passive: false,
    });
  }
  surface.addEventListener(
    "pointerdown",
    (event) => {
      preventDefault(event);
      surface.ownerDocument.getSelection()?.removeAllRanges();
    },
    { capture: true },
  );
}

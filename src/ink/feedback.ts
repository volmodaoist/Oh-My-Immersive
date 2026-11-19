const timers = new WeakMap<HTMLElement, { win: Window; timer: number }>();

/** Brief native-style click feedback without changing the control's label. */
export function flashInkButton(button: HTMLElement): void {
  const win = button.ownerDocument.defaultView;
  if (!win) return;
  const previous = timers.get(button);
  if (previous) previous.win.clearTimeout(previous.timer);
  button.classList.add("oh-my-immersive-ink-clicked");
  const timer = win.setTimeout(() => {
    button.classList.remove("oh-my-immersive-ink-clicked");
    timers.delete(button);
  }, 220);
  timers.set(button, { win, timer });
}

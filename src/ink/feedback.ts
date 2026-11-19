const timers = new WeakMap<
  HTMLElement,
  {
    win: Window;
    timer: number;
  }
>();

/** 在控件所属窗口短暂高亮，不修改文字或图标，也不创建全局通知。 */
export function flashInkButton(button: HTMLElement): void {
  const win = button.ownerDocument.defaultView;
  if (!win) {
    return;
  }
  const previous = timers.get(button);
  if (previous) {
    previous.win.clearTimeout(previous.timer);
  }
  button.classList.add("oh-my-immersive-ink-clicked");
  const timer = win.setTimeout(() => {
    button.classList.remove("oh-my-immersive-ink-clicked");
    timers.delete(button);
  }, 220);
  timers.set(button, { win, timer });
}

import type { MarkdownView } from "obsidian";
import { MarkdownScrollMode, ScrollResult } from "./enums";
import type { ScrollRequest, ScrollState } from "./scroll";

interface ScrollContext {
  view: MarkdownView;
  path: string;
  mode: MarkdownScrollMode;
  container: HTMLElement;
}

/** 只操作宿主提供的 Markdown 视图，不派发键盘事件，也不改变编辑焦点。 */
export class MarkdownScrollHost {
  private context: ScrollContext | null = null;
  private generation = 0;

  constructor(private readonly activeView: () => MarkdownView | null) {}

  getState(): ScrollState {
    const view = this.activeView();
    const value = view?.getMode();
    const mode =
      value === MarkdownScrollMode.Source
        ? MarkdownScrollMode.Source
        : value === MarkdownScrollMode.Preview
          ? MarkdownScrollMode.Preview
          : null;
    const container = view
      ? mode === MarkdownScrollMode.Source
        ? view.containerEl.querySelector<HTMLElement>(".cm-scroller")
        : mode === MarkdownScrollMode.Preview
          ? view.previewMode.containerEl
          : null
      : null;
    if (
      !view?.file ||
      !mode ||
      !container?.isConnected ||
      container.clientHeight <= 0
    ) {
      this.context = null;
      return { target: null };
    }
    const previous = this.context;
    if (
      previous?.view !== view ||
      previous.path !== view.file.path ||
      previous.mode !== mode ||
      previous.container !== container
    ) {
      this.generation++;
    }
    this.context = { view, path: view.file.path, mode, container };
    return { target: `v${this.generation}` };
  }

  scroll(request: ScrollRequest): ScrollResult {
    const state = this.getState();
    const context = this.context;
    if (!state.target || !context) {
      return ScrollResult.Unavailable;
    }
    if (request.target !== state.target) {
      return ScrollResult.Stale;
    }
    const { view, container, mode } = context;
    const current =
      mode === MarkdownScrollMode.Source
        ? view.editor.getScrollInfo().top
        : container.scrollTop;
    const maximum = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    const top = Math.max(
      0,
      Math.min(maximum, current + request.amount * container.clientHeight),
    );
    if (mode === MarkdownScrollMode.Source) {
      view.editor.scrollTo(null, top);
    } else {
      container.scrollTop = top;
    }
    return ScrollResult.Applied;
  }
}

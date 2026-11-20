import { ButtonComponent, Component } from "obsidian";
import { InkConnectionState } from "./enums";
import { flashInkButton } from "./feedback";

export interface InkConnectionLabels {
  inkConnect: string;
  inkHint: string;
  inkAddress: string;
  inkShowAddress: string;
  inkHideAddress: string;
  inkCopy: string;
  inkCopyFailed: string;
  inkStart: string;
  inkStop: string;
  inkStopping: string;
  inkStopped: string;
  inkClear: string;
  inkStarting: string;
  inkRunning: string;
}

export interface InkConnectionHost {
  connection(): { local: string; lan: string[] } | null;
  starting(): boolean;
  stopping(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): void;
  closed(): void;
}

/** 非模态控制面板。悬停时临时显示，点击或操作后固定，关闭面板不停止服务。 */
export class InkConnectionPopover extends Component {
  private panel: HTMLElement | null = null;
  private addressRow: HTMLElement | null = null;
  private address: HTMLInputElement | null = null;
  private status: HTMLElement | null = null;
  private revealButton: ButtonComponent | null = null;
  private startButton: ButtonComponent | null = null;
  private copyButton: ButtonComponent | null = null;
  private stopButton: ButtonComponent | null = null;
  private clearButton: ButtonComponent | null = null;
  private copying = false;
  private error: string | null = null;
  private closeTimer: number | null = null;
  private pinned = false;

  constructor(
    readonly anchor: HTMLElement,
    private readonly host: InkConnectionHost,
    private readonly labels: InkConnectionLabels,
  ) {
    super();
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  open(focus = false): void {
    if (this.panel) {
      return;
    }
    this.load();
    if (focus) {
      this.pin();
      this.focusAction();
    }
  }

  onload(): void {
    const doc = this.anchor.ownerDocument;
    const win = doc.defaultView;
    if (!win) {
      return;
    }
    const t = this.labels;
    const panel = doc.body.createDiv({
      cls: "oh-my-immersive-ink-popover",
      attr: { popover: "manual", role: "dialog", "aria-label": t.inkConnect },
    });
    this.panel = panel;
    panel.createDiv({ text: t.inkConnect, cls: "oh-my-immersive-ink-title" });
    panel.createEl("p", { text: t.inkHint, cls: "oh-my-immersive-ink-hint" });
    this.status = panel.createDiv({
      cls: "oh-my-immersive-ink-status",
      attr: { "aria-live": "polite", role: "status" },
    });
    this.addressRow = panel.createDiv({
      cls: "oh-my-immersive-ink-address-row",
    });
    this.addressRow.createDiv({
      text: t.inkAddress,
      cls: "oh-my-immersive-ink-address-label",
    });
    const field = this.addressRow.createDiv({
      cls: "oh-my-immersive-ink-address-field",
    });
    this.address = field.createEl("input", {
      type: "password",
      cls: "oh-my-immersive-ink-address",
      attr: {
        readonly: "",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": t.inkAddress,
      },
    });
    this.revealButton = new ButtonComponent(field)
      .setIcon("eye")
      .onClick(() => {
        if (!this.address || !this.revealButton) {
          return;
        }
        flashInkButton(this.revealButton.buttonEl);
        this.address.type =
          this.address.type === "password" ? "text" : "password";
        this.updateRevealButton();
      });
    this.revealButton.buttonEl.addClass(
      "oh-my-immersive-ink-reveal",
      "clickable-icon",
    );

    const actions = panel.createDiv({ cls: "oh-my-immersive-ink-actions" });
    this.startButton = new ButtonComponent(actions)
      .setButtonText(t.inkStart)
      .setCta()
      .onClick(() => {
        void this.runAction(this.startButton, () => this.host.start());
      });
    this.startButton.buttonEl.addClass("oh-my-immersive-ink-wide");
    this.copyButton = new ButtonComponent(actions)
      .setButtonText(t.inkCopy)
      .setCta()
      .onClick(() => {
        void this.copyAddress();
      });
    this.copyButton.buttonEl.addClass("oh-my-immersive-ink-wide");
    this.stopButton = new ButtonComponent(actions)
      .setButtonText(t.inkStop)
      .onClick(() => {
        void this.runAction(this.stopButton, () => this.host.stop());
      });
    this.clearButton = new ButtonComponent(actions)
      .setButtonText(t.inkClear)
      .onClick(() => {
        void this.runAction(this.clearButton, () => this.host.clear());
      });

    this.registerDomEvent(this.anchor, "pointerenter", () =>
      this.cancelClose(),
    );
    this.registerDomEvent(this.anchor, "pointerleave", () =>
      this.scheduleClose(),
    );
    this.registerDomEvent(panel, "pointerenter", () => this.cancelClose());
    this.registerDomEvent(panel, "pointerleave", () => this.scheduleClose());
    this.registerDomEvent(panel, "pointerdown", () => this.pin());
    this.registerDomEvent(panel, "focusin", () => this.pin());
    this.registerDomEvent(
      doc,
      "pointerdown",
      (event) => {
        if (
          !event.composedPath().includes(panel) &&
          !event.composedPath().includes(this.anchor)
        ) {
          this.close();
        }
      },
      true,
    );
    this.registerDomEvent(
      doc,
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
      },
      true,
    );
    this.registerDomEvent(win, "resize", () => this.position());
    this.registerDomEvent(doc, "scroll", () => this.position(), true);
    this.anchor.setAttribute("aria-expanded", "true");
    panel.showPopover();
    this.refresh();
  }

  pin(): void {
    this.pinned = true;
    this.cancelClose();
  }

  focusAction(): void {
    const button = this.host.connection() ? this.copyButton : this.startButton;
    button?.buttonEl.focus();
  }

  /** 给指针留出越过按钮与面板之间空隙的时间，不在操作中自动收起。 */
  private scheduleClose(): void {
    this.cancelClose();
    if (this.pinned) {
      return;
    }
    const win = this.anchor.ownerDocument.defaultView;
    if (win) {
      this.closeTimer = win.setTimeout(() => this.close(), 250);
    }
  }

  private cancelClose(): void {
    if (this.closeTimer !== null) {
      this.anchor.ownerDocument.defaultView?.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private async runAction(
    button: ButtonComponent | null,
    action: () => void | Promise<void>,
  ): Promise<void> {
    this.pin();
    if (button) {
      flashInkButton(button.buttonEl);
    }
    this.error = null;
    try {
      await action();
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }

  /** 始终复制完整地址及连接码；视觉遮挡不改变剪贴板内容。 */
  private async copyAddress(): Promise<void> {
    const connection = this.host.connection();
    if (!connection || this.copying) {
      return;
    }
    this.copying = true;
    this.refresh();
    await this.runAction(this.copyButton, async () => {
      const clipboard =
        this.anchor.ownerDocument.defaultView?.navigator.clipboard;
      try {
        if (!clipboard) {
          throw new Error(this.labels.inkCopyFailed);
        }
        await clipboard.writeText(connection.lan[0] ?? connection.local);
      } catch {
        throw new Error(this.labels.inkCopyFailed);
      }
    });
    this.copying = false;
    this.refresh();
  }

  private updateRevealButton(): void {
    const visible = this.address?.type === "text";
    const label = visible
      ? this.labels.inkHideAddress
      : this.labels.inkShowAddress;
    this.revealButton?.setIcon(visible ? "eye-off" : "eye");
    this.revealButton?.buttonEl.setAttribute("aria-label", label);
    this.revealButton?.buttonEl.setAttribute("aria-pressed", String(visible));
  }

  /** 状态来自宿主，不轮询、不重建 DOM，避免操作时丢失输入焦点。 */
  refresh(): void {
    if (!this.panel || !this.address || !this.status || !this.addressRow) {
      return;
    }
    if (!this.anchor.isConnected) {
      this.close();
      return;
    }
    const t = this.labels;
    const connection = this.host.connection();
    const starting = this.host.starting();
    const stopping = this.host.stopping();
    const active = connection !== null && !stopping;
    const value = connection ? (connection.lan[0] ?? connection.local) : "";
    // 每次服务更换连接码都重新遮挡；同一会话内保留用户的显隐选择。
    if (this.address.value !== value) {
      this.address.value = value;
      this.address.type = "password";
    }
    this.addressRow.hidden = !active;
    this.status.textContent =
      this.error ??
      (starting
        ? t.inkStarting
        : stopping
          ? t.inkStopping
          : active
            ? t.inkRunning
            : t.inkStopped);
    this.status.setAttribute(
      "data-state",
      this.error
        ? InkConnectionState.Error
        : active
          ? InkConnectionState.Running
          : InkConnectionState.Idle,
    );
    this.startButton?.setDisabled(starting || stopping);
    this.startButton?.buttonEl.setAttribute("aria-busy", String(starting));
    if (this.startButton) this.startButton.buttonEl.hidden = active;
    this.copyButton?.setDisabled(!active || this.copying);
    this.copyButton?.buttonEl.setAttribute("aria-busy", String(this.copying));
    if (this.copyButton) this.copyButton.buttonEl.hidden = !active;
    this.stopButton?.setDisabled(!active || starting || stopping);
    this.stopButton?.buttonEl.setAttribute("aria-busy", String(stopping));
    if (this.stopButton) this.stopButton.buttonEl.hidden = !active;
    this.clearButton?.setDisabled(!active);
    if (this.clearButton) this.clearButton.buttonEl.hidden = !active;
    this.updateRevealButton();
    this.position();
  }

  /** 顶层 popover 不受标题栏 overflow 裁剪，空间不足时放到按钮上方。 */
  private position(): void {
    const panel = this.panel;
    const win = this.anchor.ownerDocument.defaultView;
    if (!panel || !win) {
      return;
    }
    const anchor = this.anchor.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const left = Math.max(
      margin,
      Math.min(
        anchor.right - panel.offsetWidth,
        win.innerWidth - panel.offsetWidth - margin,
      ),
    );
    const below = anchor.bottom + gap;
    const top =
      below + panel.offsetHeight <= win.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - panel.offsetHeight - gap);
    panel.setCssProps({
      "--ink-popover-left": `${left}px`,
      "--ink-popover-top": `${top}px`,
    });
  }

  close(restoreFocus = false): void {
    if (!this.panel) {
      return;
    }
    this.unload();
    if (restoreFocus && this.anchor.isConnected) {
      this.anchor.focus();
    }
  }

  onunload(): void {
    this.cancelClose();
    this.panel?.remove();
    this.panel = null;
    this.anchor.setAttribute("aria-expanded", "false");
    this.host.closed();
  }
}

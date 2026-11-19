import { App, ButtonComponent, Modal } from "obsidian";
import { flashInkButton } from "./feedback";

export interface InkDialogLabels {
  inkConnect: string;
  inkIntro: string;
  inkAddress: string;
  inkCopy: string;
  inkCopyFailed: string;
  inkStop: string;
  inkStopping: string;
  inkStopped: string;
  inkClear: string;
  inkStarting: string;
  inkRunning: string;
}
export interface InkDialogHost {
  connection(): { local: string; lan: string[] } | null;
  starting(): boolean;
  stopping(): boolean;
  stop(): Promise<void>;
  clear(): void;
  closed(): void;
}

/** Labels stay stable; clicks flash, while service state and errors stay inline. */
export class InkConnectionModal extends Modal {
  private address: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private copyButton: ButtonComponent | null = null;
  private stopButton: ButtonComponent | null = null;
  private clearButton: ButtonComponent | null = null;
  private copying = false;
  private error: string | null = null;

  constructor(app: App, private readonly host: InkDialogHost, private readonly labels: InkDialogLabels) {
    super(app);
    this.setTitle(labels.inkConnect);
    this.modalEl.addClass("oh-my-immersive-ink-modal");
  }

  onOpen(): void {
    const t = this.labels;
    this.contentEl.createEl("p", { text: t.inkIntro });
    this.contentEl.createDiv({ text: t.inkAddress, cls: "oh-my-immersive-ink-address-label" });
    this.address = this.contentEl.createEl("code", { cls: "oh-my-immersive-ink-address" });
    this.status = this.contentEl.createEl("p", { cls: "oh-my-immersive-ink-status", attr: { "aria-live": "polite", role: "status" } });
    const actions = this.contentEl.createDiv({ cls: "oh-my-immersive-ink-actions" });
    this.copyButton = new ButtonComponent(actions).setButtonText(t.inkCopy).setCta().onClick(async () => {
      const connection = this.host.connection();
      if (!connection || this.copying) return;
      if (this.copyButton) flashInkButton(this.copyButton.buttonEl);
      this.copying = true; this.error = null;
      this.refresh();
      try {
        const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
        if (!clipboard) throw new Error(t.inkCopyFailed);
        await clipboard.writeText(connection.lan[0] ?? connection.local);
      } catch { this.error = t.inkCopyFailed; }
      finally { this.copying = false; this.refresh(); }
    });
    this.stopButton = new ButtonComponent(actions).setButtonText(t.inkStop).onClick(async () => {
      if (this.stopButton) flashInkButton(this.stopButton.buttonEl);
      this.error = null;
      try { await this.host.stop(); }
      catch (error: unknown) { this.error = error instanceof Error ? error.message : t.inkStopped; }
      this.refresh();
    });
    this.clearButton = new ButtonComponent(actions).setButtonText(t.inkClear).onClick(() => {
      if (this.clearButton) flashInkButton(this.clearButton.buttonEl);
      this.error = null;
      try { this.host.clear(); }
      catch (error: unknown) { this.error = error instanceof Error ? error.message : t.inkClear; }
      this.refresh();
    });
    this.refresh();
  }

  resetFeedback(): void {
    this.error = null;
    this.refresh();
  }

  showError(message: string): void { this.error = message; this.refresh(); }

  refresh(): void {
    if (!this.address || !this.status) return;
    const t = this.labels, connection = this.host.connection();
    const address = connection ? connection.lan[0] ?? connection.local : "—";
    this.address.textContent = address;
    const starting = this.host.starting(), stopping = this.host.stopping();
    const active = connection !== null && !stopping;
    this.status.textContent = this.error ?? (starting ? t.inkStarting : stopping ? t.inkStopping : active ? t.inkRunning : t.inkStopped);
    this.status.setAttribute("data-state", this.error ? "error" : active ? "running" : "idle");
    this.copyButton?.setDisabled(!active || this.copying);
    this.copyButton?.buttonEl.setAttribute("aria-busy", String(this.copying));
    this.stopButton?.setDisabled(!active || starting || stopping);
    this.stopButton?.buttonEl.setAttribute("aria-busy", String(stopping));
    this.clearButton?.setDisabled(!active);
  }

  onClose(): void {
    this.address = null; this.status = null;
    this.contentEl.empty();
    this.host.closed();
  }
}

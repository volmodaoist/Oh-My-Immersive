import { InkServer } from "./server";
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface WebContents {
  capturePage(): Promise<{
    toJPEG(quality: number): Uint8Array;
  }>;
}
interface NativeWindow {
  getContentBounds(): Bounds;
  setBounds(bounds: Bounds): void;
  loadURL(url: string): Promise<void>;
  setIgnoreMouseEvents(
    ignore: boolean,
    options: {
      forward: boolean;
    },
  ): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  on(event: string, listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
}
interface NativeRemote {
  getCurrentWindow(): NativeWindow;
  getCurrentWebContents(): WebContents;
  BrowserWindow: new (options: Record<string, unknown>) => NativeWindow;
}

/** 桌面宿主创建透明笔迹层；底图只截取主窗口，避免笔迹被再次回传叠加。 */
export class RemoteInk {
  private readonly server: InkServer;
  private layer: NativeWindow | null = null;
  private parent: NativeWindow | null = null;
  private contents: WebContents | null = null;
  private framePromise: Promise<Uint8Array> | null = null;
  private frameTime = 0;
  private stopped = false;
  constructor() {
    this.server = new InkServer({ frame: () => this.capture() });
  }
  get connection(): {
    local: string;
    lan: string[];
    code: string;
  } {
    return {
      local: this.server.localURL(),
      lan: this.server.urls(),
      code: this.server.code,
    };
  }
  /** 该模块由桌面入口延迟加载；接口检查失败时不留下半启动服务。 */
  async start(port: number): Promise<void> {
    const win = window as unknown as {
      electron?: {
        remote?: NativeRemote;
      };
    };
    const remote = win.electron?.remote;
    if (
      !remote ||
      typeof remote.getCurrentWindow !== "function" ||
      typeof remote.BrowserWindow !== "function"
    ) {
      throw new Error("当前 Obsidian 没有提供透明窗口接口，无法启动远程书写。");
    }
    this.parent = remote.getCurrentWindow();
    this.contents = remote.getCurrentWebContents();
    if (typeof this.contents.capturePage !== "function") {
      throw new Error("当前 Obsidian 无法获取窗口底图。");
    }
    try {
      await this.server.start(port);
      const bounds = this.parent.getContentBounds();
      this.server.dimensions(bounds.width, bounds.height);
      this.layer = new remote.BrowserWindow({
        ...bounds,
        parent: this.parent,
        frame: false,
        transparent: true,
        show: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        movable: false,
        resizable: false,
        backgroundColor: "#00000000",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      this.layer.setIgnoreMouseEvents(true, { forward: true });
      await this.layer.loadURL(this.server.localURL(true));
      if (this.parent.isVisible()) {
        this.layer.showInactive();
      }
      this.parent.on("move", this.align);
      this.parent.on("resize", this.align);
      this.parent.on("show", this.show);
      this.parent.on("restore", this.show);
      this.parent.on("hide", this.hide);
      this.parent.on("minimize", this.hide);
      this.parent.on("closed", this.close);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private readonly align = (): void => {
    if (
      !this.parent ||
      this.parent.isDestroyed() ||
      !this.layer ||
      this.layer.isDestroyed()
    ) {
      return;
    }
    const bounds = this.parent.getContentBounds();
    this.layer.setBounds(bounds);
    this.server.dimensions(bounds.width, bounds.height);
  };
  private readonly show = (): void => {
    this.align();
    this.layer?.showInactive();
  };
  private readonly hide = (): void => {
    this.layer?.hide();
  };
  private readonly close = (): void => {
    void this.stop();
  };
  clear(): void {
    this.server.clear();
  }
  /** 短时间共享取图结果，多个浏览器连接不必各自截取同一窗口。 */
  private capture(): Promise<Uint8Array> {
    if (this.stopped || !this.contents) {
      return Promise.reject(new Error("书写服务已停止"));
    }
    if (!this.framePromise || Date.now() - this.frameTime > 300) {
      this.frameTime = Date.now();
      this.framePromise = this.contents
        .capturePage()
        .then((image) => image.toJPEG(85))
        .catch((error: unknown) => {
          this.framePromise = null;
          throw error;
        });
    }
    return this.framePromise;
  }
  /** 清理窗口监听、透明层和网络连接；重复停止调用保持安全。 */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.parent && !this.parent.isDestroyed()) {
      for (const [event, listener] of [
        ["move", this.align],
        ["resize", this.align],
        ["show", this.show],
        ["restore", this.show],
        ["hide", this.hide],
        ["minimize", this.hide],
        ["closed", this.close],
      ] as const) {
        this.parent.removeListener(event, listener);
      }
    }
    if (this.layer && !this.layer.isDestroyed()) {
      this.layer.destroy();
    }
    this.layer = null;
    await this.server.stop();
  }
}

/** 解码后的位图拥有释放方法，显示画布复制像素后再释放资源。 */
export interface DecodedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

export type FrameDecoder = (blob: Blob, doc: Document) => Promise<DecodedFrame>;

/** 优先使用 ImageBitmap；旧 WebKit 回退到未挂载的 Image 元素。 */
async function decodeFrame(blob: Blob, doc: Document): Promise<DecodedFrame> {
  const win = doc.defaultView;
  if (!win) {
    throw new Error("Frame document is unavailable");
  }
  if (typeof win.createImageBitmap === "function") {
    try {
      const bitmap = await win.createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* 某些旧 WebKit 暴露 API 却不支持特定图片，继续尝试兼容路径。 */
    }
  }
  const url = win.URL.createObjectURL(blob);
  try {
    const image = new win.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Frame decoding failed"));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => win.URL.revokeObjectURL(url),
    };
  } catch (error) {
    win.URL.revokeObjectURL(url);
    throw error;
  }
}

/** 显示层独立持有像素；新帧加载期间不移除旧帧，解码失败也保留旧画面。 */
export class FramePainter {
  private generation = 0;
  private disposed = false;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly decode: FrameDecoder = decodeFrame,
  ) {}
  async show(blob: Blob): Promise<void> {
    // 多次请求重叠时，较晚完成的旧帧不能覆盖更新的画面。
    const generation = ++this.generation;
    const frame = await this.decode(blob, this.canvas.ownerDocument);
    try {
      if (this.disposed || generation !== this.generation) {
        return;
      }
      if (!frame.width || !frame.height) {
        throw new Error("Empty frame");
      }
      const context = this.canvas.getContext("2d");
      if (!context) {
        throw new Error("Frame canvas is unavailable");
      }
      // 尺寸相同时不重置画布；新图就绪后，尺寸变化和绘制在同一同步步骤完成。
      if (this.canvas.width !== frame.width) {
        this.canvas.width = frame.width;
      }
      if (this.canvas.height !== frame.height) {
        this.canvas.height = frame.height;
      }
      context.globalCompositeOperation = "copy";
      context.drawImage(frame.source, 0, 0, frame.width, frame.height);
    } finally {
      frame.release();
    }
  }

  destroy(): void {
    this.disposed = true;
    this.generation++;
  }
}

export interface DecodedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}
export type FrameDecoder = (blob: Blob, doc: Document) => Promise<DecodedFrame>;

async function decodeFrame(blob: Blob, doc: Document): Promise<DecodedFrame> {
  const win = doc.defaultView;
  if (!win) throw new Error("Frame document is unavailable");
  if (typeof win.createImageBitmap === "function") {
    try {
      const bitmap = await win.createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* Older WebKit builds can expose this API but reject some images. */ }
  }
  const url = win.URL.createObjectURL(blob);
  try {
    const image = new win.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Frame decoding failed"));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => win.URL.revokeObjectURL(url) };
  } catch (error) { win.URL.revokeObjectURL(url); throw error; }
}

/** The display owns its pixels. Loading/decoding a replacement never removes
 * the previous frame, and decoded resources are released only after drawing. */
export class FramePainter {
  private generation = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly decode: FrameDecoder = decodeFrame) {}

  async show(blob: Blob): Promise<void> {
    const generation = ++this.generation;
    const frame = await this.decode(blob, this.canvas.ownerDocument);
    try {
      if (this.disposed || generation !== this.generation) return;
      if (!frame.width || !frame.height) throw new Error("Empty frame");
      const context = this.canvas.getContext("2d");
      if (!context) throw new Error("Frame canvas is unavailable");
      // Only reset the backing buffer when dimensions actually change. Resize
      // and draw happen synchronously, after the new image is ready.
      if (this.canvas.width !== frame.width) this.canvas.width = frame.width;
      if (this.canvas.height !== frame.height) this.canvas.height = frame.height;
      context.globalCompositeOperation = "copy";
      context.drawImage(frame.source, 0, 0, frame.width, frame.height);
    } finally { frame.release(); }
  }

  destroy(): void { this.disposed = true; this.generation++; }
}

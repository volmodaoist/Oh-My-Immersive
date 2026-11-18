import type { Point, Stroke } from "./protocol";

export interface PointerSample {
  pointerType: string;
  button: number;
  buttons: number;
  pressure: number;
}
export function acceptsPointer(event: PointerSample): boolean {
  return (event.pointerType === "pen" || event.pointerType === "mouse") && event.button === 0;
}
export function pressureOf(event: PointerSample): number {
  return event.pointerType === "pen" ? Math.max(0.05, Math.min(1, event.pressure || 0.3)) : 0.55;
}
export function normalizedPoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number }, pressure: number): Point {
  return [Math.max(0, Math.min(1, (x - rect.left) / rect.width)), Math.max(0, Math.min(1, (y - rect.top) / rect.height)), pressure];
}
export function hitStroke(stroke: Stroke, point: Point, width: number, height: number, radius = 14): boolean {
  const x = point[0] * width, y = point[1] * height;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
    const ax = a[0] * width, ay = a[1] * height;
    const dx = (b[0] - a[0]) * width, dy = (b[1] - a[1]) * height;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius) return true;
  }
  return false;
}
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, from = 0): void {
  const pts = stroke.points;
  const scale = width / 1280;
  const lineWidth = (p: number) => stroke.size * scale * (stroke.tool === "marker" ? 2.4 : 0.35 + 1.15 * p);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Alpha is applied once when composing the marker layer, so overlapping
  // sample segments do not make highlights darker at every join.
  if (from === 0 && pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * width, pts[0][1] * height, lineWidth(pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    ctx.beginPath();
    ctx.moveTo(a[0] * width, a[1] * height);
    ctx.lineTo(b[0] * width, b[1] * height);
    ctx.lineWidth = lineWidth(b[2]);
    ctx.stroke();
  }
}

/** Completed strokes and the active stroke have separate retained canvases.
 * Compositing never erases the earlier segments of an unfinished stroke. */
export class InkPainter {
  private readonly committed: HTMLCanvasElement;
  private readonly active: HTMLCanvasElement;
  private readonly segment: HTMLCanvasElement;
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.committed = canvas.ownerDocument.createElement("canvas");
    this.active = canvas.ownerDocument.createElement("canvas");
    this.segment = canvas.ownerDocument.createElement("canvas");
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = Math.min(2, this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    for (const layer of [this.canvas, this.committed, this.active, this.segment]) {
      layer.width = Math.round(this.width * ratio);
      layer.height = Math.round(this.height * ratio);
      layer.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }

  rebuild(strokes: Iterable<Stroke>): void {
    const ctx = this.committed.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const stroke of strokes) this.paintInto(ctx, stroke);
  }

  live(stroke: Stroke | null): void {
    const ctx = this.active.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    if (stroke) drawStroke(ctx, stroke, this.width, this.height);
    this.compose(stroke?.tool === "marker");
  }

  private paintInto(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.tool === "pen") { drawStroke(ctx, stroke, this.width, this.height); return; }
    const segment = this.segment.getContext("2d");
    if (!segment) return;
    segment.clearRect(0, 0, this.width, this.height);
    drawStroke(segment, stroke, this.width, this.height);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(this.segment, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }

  private compose(marker = false): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.committed, 0, 0, this.width, this.height);
    ctx.globalAlpha = marker ? 0.35 : 1;
    ctx.drawImage(this.active, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }
}

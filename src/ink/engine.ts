import { DrawingTool, PointerType, parsePointerType } from "./enums";
import type { Point, Stroke } from "./protocol";

export interface PointerSample {
  pointerType: string;
  button: number;
  buttons: number;
  pressure: number;
}

/** 只允许笔尖和鼠标左键，过滤手指、手掌及鼠标右键。 */
export function acceptsPointer(event: PointerSample): boolean {
  return (
    (parsePointerType(event.pointerType) === PointerType.Pen ||
      parsePointerType(event.pointerType) === PointerType.Mouse) &&
    event.button === 0
  );
}

/** 鼠标使用固定压感；Pencil 缺失压感值时仍保持可见的笔宽。 */
export function pressureOf(event: PointerSample): number {
  return parsePointerType(event.pointerType) === PointerType.Pen
    ? Math.max(0.05, Math.min(1, event.pressure || 0.3))
    : 0.55;
}

/** 将指针位置转换为舞台比例坐标，排除浏览器工具栏和留白偏移。 */
export function normalizedPoint(
  x: number,
  y: number,
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
  pressure: number,
): Point {
  return [
    Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
    Math.max(0, Math.min(1, (y - rect.top) / rect.height)),
    pressure,
  ];
}

/** 投影到每段线段检测命中，稀疏采样的长线也能被橡皮擦到。 */
export function hitStroke(
  stroke: Stroke,
  point: Point,
  width: number,
  height: number,
  radius = 14,
): boolean {
  const x = point[0] * width,
    y = point[1] * height;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)],
      b = stroke.points[i];
    const ax = a[0] * width,
      ay = a[1] * height;
    const dx = (b[0] - a[0]) * width,
      dy = (b[1] - a[1]) * height;
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius) {
      return true;
    }
  }
  return false;
}

/** 仅画单条笔迹的几何形状，荧光笔透明度由合成阶段统一处理。 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  from = 0,
): void {
  const pts = stroke.points;
  const scale = width / 1280;
  const lineWidth = (p: number) =>
    stroke.size *
    scale *
    (stroke.tool === DrawingTool.Marker ? 2.4 : 0.35 + 1.15 * p);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 荧光笔先绘制为不透明图层，再一次性应用透明度，避免接缝越叠越深。
  if (from === 0 && pts.length === 1) {
    ctx.beginPath();
    ctx.arc(
      pts[0][0] * width,
      pts[0][1] * height,
      lineWidth(pts[0][2]) / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    ctx.beginPath();
    ctx.moveTo(a[0] * width, a[1] * height);
    ctx.lineTo(b[0] * width, b[1] * height);
    ctx.lineWidth = lineWidth(b[2]);
    ctx.stroke();
  }
}

/** 已完成笔迹、活动笔迹和荧光笔临时层分别保留；
 * 合成时不会丢失同一条笔迹先前已经采集的线段。 */
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
  /** 限制高分屏的像素比例，平衡文字锐度与画布内存使用。 */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = Math.min(
      2,
      this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
    );
    for (const layer of [
      this.canvas,
      this.committed,
      this.active,
      this.segment,
    ]) {
      layer.width = Math.round(this.width * ratio);
      layer.height = Math.round(this.height * ratio);
      layer.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }
  /** 新笔迹完成、擦除或远端操作改变结构后，重建确认层。 */
  rebuild(strokes: Iterable<Stroke>): void {
    const ctx = this.committed.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    for (const stroke of strokes) {
      this.paintInto(ctx, stroke);
    }
  }
  /** 活动层包含完整当前笔迹，再与确认层合成到显示画布。 */
  live(stroke: Stroke | null): void {
    const ctx = this.active.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    if (stroke) {
      drawStroke(ctx, stroke, this.width, this.height);
    }
    this.compose(stroke?.tool === DrawingTool.Marker);
  }

  private paintInto(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.tool === DrawingTool.Pen) {
      drawStroke(ctx, stroke, this.width, this.height);
      return;
    }
    const segment = this.segment.getContext("2d");
    if (!segment) {
      return;
    }
    segment.clearRect(0, 0, this.width, this.height);
    drawStroke(segment, stroke, this.width, this.height);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(this.segment, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }

  private compose(marker = false): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.committed, 0, 0, this.width, this.height);
    ctx.globalAlpha = marker ? 0.35 : 1;
    ctx.drawImage(this.active, 0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }
}

import { DrawingTool, InkOperationType, parseOperationType } from "./enums";

/** 坐标归一化为 0～1，使 iPad 和本机不同大小的画面保持位置对应。 */
export type Point = [x: number, y: number, pressure: number];

export type StrokeTool = DrawingTool.Pen | DrawingTool.Marker;

export const MAX_BATCH_POINTS = 2048;
const MAX_STROKES = 4096;
const MAX_STROKE_POINTS = 100000;

export interface Stroke {
  id: string;
  owner: string;
  tool: StrokeTool;
  color: string;
  size: number;
  points: Point[];
  complete: boolean;
}

/** 落笔立即创建一条未完成笔迹，随后通过 Append 分批补齐采样点。 */
export interface BeginStrokeOperation {
  t: InkOperationType.Begin;
  stroke: Stroke;
}

export interface AppendStrokeOperation {
  t: InkOperationType.Append;
  id: string;
  /** 本批第一个点在完整笔迹中的下标，用于检测重复或缺失的批次。 */
  offset: number;
  points: Point[];
}

export interface EndStrokeOperation {
  t: InkOperationType.End;
  id: string;
}

export interface CancelStrokeOperation {
  t: InkOperationType.Cancel;
  id: string;
}

export interface DeleteStrokesOperation {
  t: InkOperationType.Delete;
  ids: string[];
}

export interface ClearInkOperation {
  t: InkOperationType.Clear;
}

/** 以枚举成员作为判别字段，同时保留每种操作各自的载荷类型。 */
export type InkOp =
  | BeginStrokeOperation
  | AppendStrokeOperation
  | EndStrokeOperation
  | CancelStrokeOperation
  | DeleteStrokesOperation
  | ClearInkOperation;

export interface InkSnapshot {
  revision: number;
  strokes: Stroke[];
}

export interface InkDimensions {
  width: number;
  height: number;
}

export interface InkViewerSnapshot extends InkSnapshot, InkDimensions {}

export interface InkEvent {
  revision: number;
  op: InkOp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}

function isUnitValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isPoints(value: unknown): value is Point[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_BATCH_POINTS &&
    value.every(
      (point: unknown) =>
        Array.isArray(point) && point.length === 3 && point.every(isUnitValue),
    )
  );
}

function isStrokeTool(value: unknown): value is StrokeTool {
  return value === DrawingTool.Pen || value === DrawingTool.Marker;
}

/** 网络入口只接收合法、有限大小的数据，并剔除客户端多余的字段。 */
export function parseOp(value: unknown): InkOp {
  if (!isRecord(value)) {
    throw new Error("无效的笔迹操作");
  }
  const type = parseOperationType(value.t);
  if (type === InkOperationType.Clear) {
    return { t: type };
  }
  if (
    type === InkOperationType.Delete &&
    Array.isArray(value.ids) &&
    value.ids.length <= MAX_STROKES &&
    value.ids.every(isIdentifier)
  ) {
    return { t: type, ids: value.ids };
  }
  if (type === InkOperationType.Begin && isRecord(value.stroke)) {
    const stroke = value.stroke;
    if (
      isIdentifier(stroke.id) &&
      isIdentifier(stroke.owner) &&
      isStrokeTool(stroke.tool) &&
      typeof stroke.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(stroke.color) &&
      typeof stroke.size === "number" &&
      Number.isFinite(stroke.size) &&
      stroke.size >= 1 &&
      stroke.size <= 24 &&
      isPoints(stroke.points) &&
      stroke.points.length === 1
    ) {
      return {
        t: type,
        stroke: {
          id: stroke.id,
          owner: stroke.owner,
          tool: stroke.tool,
          color: stroke.color,
          size: stroke.size,
          points: stroke.points,
          complete: false,
        },
      };
    }
  }
  if (isIdentifier(value.id)) {
    if (
      type === InkOperationType.Append &&
      Number.isInteger(value.offset) &&
      Number(value.offset) > 0 &&
      isPoints(value.points)
    ) {
      return {
        t: type,
        id: value.id,
        offset: Number(value.offset),
        points: value.points,
      };
    }
    if (type === InkOperationType.End || type === InkOperationType.Cancel) {
      return { t: type, id: value.id };
    }
  }
  throw new Error("无效的笔迹操作");
}

/** 服务端是唯一的笔迹状态来源；全部内容只保留在当前服务的内存中。 */
export class InkStore {
  readonly strokes = new Map<string, Stroke>();
  revision = 0;
  /** 只有实际改变状态时才递增 revision，客户端据此识别重复和丢失事件。 */
  apply(operation: InkOp): boolean {
    switch (operation.t) {
      case InkOperationType.Begin:
        if (this.strokes.has(operation.stroke.id)) {
          return false;
        }
        if (this.strokes.size >= MAX_STROKES) {
          throw new Error("笔迹数量已达上限，请清空画面");
        }
        this.strokes.set(operation.stroke.id, {
          ...operation.stroke,
          points: operation.stroke.points.slice(),
          complete: false,
        });
        break;
      case InkOperationType.Append: {
        const stroke = this.strokes.get(operation.id);
        if (!stroke || stroke.complete) {
          throw new Error("笔迹已结束或不存在，请重新连接");
        }
        // 已覆盖的下标视为重复批次；跳过下标则说明采样点缺失。
        if (operation.offset < stroke.points.length) {
          return false;
        }
        if (operation.offset !== stroke.points.length) {
          throw new Error("笔迹采样顺序不一致，请重新连接");
        }
        if (
          stroke.points.length + operation.points.length >
          MAX_STROKE_POINTS
        ) {
          throw new Error("单条笔迹过长");
        }
        stroke.points.push(...operation.points);
        break;
      }
      case InkOperationType.End: {
        const stroke = this.strokes.get(operation.id);
        if (!stroke || stroke.complete) {
          return false;
        }
        stroke.complete = true;
        break;
      }
      case InkOperationType.Cancel:
        if (!this.strokes.delete(operation.id)) {
          return false;
        }
        break;
      case InkOperationType.Delete: {
        let changed = false;
        operation.ids.forEach((id) => {
          changed = this.strokes.delete(id) || changed;
        });
        if (!changed) {
          return false;
        }
        break;
      }
      case InkOperationType.Clear:
        if (this.strokes.size === 0) {
          return false;
        }
        this.strokes.clear();
        break;
    }
    this.revision++;
    return true;
  }
  /** 复制数组结构，避免连接初始化时的快照被后续追加点修改。 */
  snapshot(): InkSnapshot {
    return {
      revision: this.revision,
      strokes: [...this.strokes.values()].map((stroke) => ({
        ...stroke,
        points: stroke.points.slice(),
      })),
    };
  }
}

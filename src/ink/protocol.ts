/** Screen coordinates are normalized so the same ink fits every viewport. */
export type Point = [number, number, number];
export type Tool = "pen" | "marker";
export interface Stroke {
  id: string;
  owner: string;
  tool: Tool;
  color: string;
  size: number;
  points: Point[];
  complete: boolean;
}
export type InkOp =
  | { t: "begin"; stroke: Stroke }
  | { t: "append"; id: string; offset: number; points: Point[] }
  | { t: "end"; id: string }
  | { t: "cancel"; id: string }
  | { t: "delete"; ids: string[] }
  | { t: "clear" };
export interface InkSnapshot { revision: number; strokes: Stroke[] }
export interface InkEvent { revision: number; op: InkOp }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}
function points(value: unknown): value is Point[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 2048 &&
    value.every((point: unknown) => Array.isArray(point) && point.length === 3 &&
      point.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1));
}
export function parseOp(value: unknown): InkOp {
  if (!record(value)) throw new Error("无效的笔迹操作");
  if (value.t === "clear") return { t: "clear" };
  if (value.t === "delete" && Array.isArray(value.ids) && value.ids.length <= 4096 && value.ids.every(identifier)) {
    return { t: "delete", ids: value.ids };
  }
  if (value.t === "begin" && record(value.stroke)) {
    const s = value.stroke;
    if (identifier(s.id) && identifier(s.owner) && (s.tool === "pen" || s.tool === "marker") &&
      typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) &&
      typeof s.size === "number" && Number.isFinite(s.size) && s.size >= 1 && s.size <= 24 && points(s.points) && s.points.length === 1) {
      return { t: "begin", stroke: { id: s.id, owner: s.owner, tool: s.tool, color: s.color, size: s.size, points: s.points, complete: false } };
    }
  }
  if (identifier(value.id)) {
    if (value.t === "append" && Number.isInteger(value.offset) && Number(value.offset) > 0 && points(value.points)) {
      return { t: "append", id: value.id, offset: Number(value.offset), points: value.points };
    }
    if (value.t === "end" || value.t === "cancel") return { t: value.t, id: value.id };
  }
  throw new Error("无效的笔迹操作");
}

/** Single authoritative state; only finalized strokes are written to disk. */
export class InkStore {
  readonly strokes = new Map<string, Stroke>();
  revision = 0;

  apply(op: InkOp): boolean {
    switch (op.t) {
      case "begin":
        if (this.strokes.has(op.stroke.id)) return false;
        if (this.strokes.size >= 4096) throw new Error("笔迹数量已达上限，请清空画面");
        this.strokes.set(op.stroke.id, { ...op.stroke, points: op.stroke.points.slice(), complete: false });
        break;
      case "append": {
        const stroke = this.strokes.get(op.id);
        if (!stroke || stroke.complete) throw new Error("笔迹已结束或不存在，请重新连接");
        if (op.offset < stroke.points.length) return false;
        if (op.offset !== stroke.points.length) throw new Error("笔迹采样顺序不一致，请重新连接");
        if (stroke.points.length + op.points.length > 100000) throw new Error("单条笔迹过长");
        stroke.points.push(...op.points);
        break;
      }
      case "end": {
        const stroke = this.strokes.get(op.id);
        if (!stroke || stroke.complete) return false;
        stroke.complete = true;
        break;
      }
      case "cancel":
        if (!this.strokes.delete(op.id)) return false;
        break;
      case "delete": {
        let changed = false;
        op.ids.forEach(id => { changed = this.strokes.delete(id) || changed; });
        if (!changed) return false;
        break;
      }
      case "clear":
        if (this.strokes.size === 0) return false;
        this.strokes.clear();
        break;
    }
    this.revision++;
    return true;
  }

  snapshot(): InkSnapshot {
    return { revision: this.revision, strokes: [...this.strokes.values()].map(s => ({ ...s, points: s.points.slice() })) };
  }
  saved(): Stroke[] { return this.snapshot().strokes.filter(s => s.complete); }
  restore(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const candidate of value.slice(0, 4096)) {
      try {
        if (!record(candidate) || !Array.isArray(candidate.points) || candidate.points.length > 100000) continue;
        const first = parseOp({ t: "begin", stroke: { ...candidate, points: candidate.points.slice(0, 1) } });
        if (first.t !== "begin") continue;
        for (let i = 0; i < candidate.points.length; i += 2048) {
          if (!points(candidate.points.slice(i, i + 2048))) throw new Error("无效的笔迹");
        }
        this.strokes.set(first.stroke.id, { ...first.stroke, points: candidate.points as Point[], complete: true });
      } catch { /* Skip malformed persisted strokes. */ }
    }
  }
}

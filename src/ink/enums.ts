/** 浏览器工具栏可选择的工具；橡皮不产生新的笔迹。 */
export enum DrawingTool {
  Pen = "pen",
  Marker = "marker",
  Eraser = "eraser",
}

/** 保留现有协议字符串，旧页面发送的操作仍可由服务端识别。 */
export enum InkOperationType {
  Begin = "begin",
  Append = "append",
  End = "end",
  Cancel = "cancel",
  Delete = "delete",
  Clear = "clear",
}

/** SSE 事件名称与笔迹操作类型分开，快照和尺寸通知不修改笔迹。 */
export enum InkStreamEvent {
  Snapshot = "snapshot",
  Operation = "op",
  Dimensions = "dimensions",
}

export enum PointerType {
  Pen = "pen",
  Mouse = "mouse",
  Touch = "touch",
}

export enum InkDialogState {
  Error = "error",
  Running = "running",
  Idle = "idle",
}

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
}

export enum InkRoute {
  Page = "/",
  Client = "/client.js",
  State = "/api/state",
  Events = "/events",
  Frame = "/frame",
  Operation = "/api/op",
}
const drawingTools = new Set<string>(Object.values(DrawingTool));
const operationTypes = new Set<string>(Object.values(InkOperationType));
const pointerTypes = new Set<string>(Object.values(PointerType));
const httpMethods = new Set<string>(Object.values(HttpMethod));
const routes = new Set<string>(Object.values(InkRoute));

/** DOM 和网络输入仍是字符串，只有验证后才能进入枚举类型。 */
export function parseDrawingTool(value: unknown): DrawingTool | null {
  if (typeof value !== "string" || !drawingTools.has(value)) {
    return null;
  }
  return value as DrawingTool;
}

export function parseOperationType(value: unknown): InkOperationType | null {
  if (typeof value !== "string" || !operationTypes.has(value)) {
    return null;
  }
  return value as InkOperationType;
}

export function parsePointerType(value: unknown): PointerType | null {
  if (typeof value !== "string" || !pointerTypes.has(value)) {
    return null;
  }
  return value as PointerType;
}

export function parseHttpMethod(value: unknown): HttpMethod | null {
  if (typeof value !== "string" || !httpMethods.has(value)) {
    return null;
  }
  return value as HttpMethod;
}

export function parseInkRoute(value: unknown): InkRoute | null {
  if (typeof value !== "string" || !routes.has(value)) {
    return null;
  }
  return value as InkRoute;
}

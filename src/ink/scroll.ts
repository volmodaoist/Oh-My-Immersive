import { WheelDeltaMode, parseWheelDeltaMode } from "./enums";

export interface ScrollState {
  /** 临时目标标识，不向浏览器暴露笔记路径；切换笔记、模式或分屏后更换。 */
  target: string | null;
}

export interface ScrollRequest {
  target: string;
  /** 可视区域高度的倍数，正值向下；每次最多滚动一屏。 */
  amount: number;
}

export function parseScrollRequest(value: unknown): ScrollRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("无效的滚动指令");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.target !== "string" ||
    !/^v\d{1,12}$/.test(input.target) ||
    typeof input.amount !== "number" ||
    !Number.isFinite(input.amount) ||
    input.amount === 0 ||
    Math.abs(input.amount) > 1
  ) {
    throw new Error("无效的滚动指令");
  }
  return { target: input.target, amount: input.amount };
}

/** 浏览器滚轮可能以像素、行或页表示距离，统一转换为可视高度比例。 */
export function wheelScrollAmount(
  delta: number,
  mode: number,
  height: number,
): number {
  if (!Number.isFinite(delta) || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  const unit = parseWheelDeltaMode(mode);
  if (unit === null) {
    return 0;
  }
  const pixels =
    unit === WheelDeltaMode.Line
      ? delta * 16
      : unit === WheelDeltaMode.Page
        ? delta * height
        : delta;
  return Math.max(-1, Math.min(1, pixels / height));
}

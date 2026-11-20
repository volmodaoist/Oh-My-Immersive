/** 浏览器端先绘制本地笔迹，再通过串行 POST 上传操作；SSE 负责同步服务端状态。 */
import {
  DrawingTool,
  InkOperationType,
  InkStreamEvent,
  HttpMethod,
  InkRoute,
  parseDrawingTool,
  ScrollResult,
} from "./enums";
import {
  acceptsPointer,
  normalizedPoint,
  pressureOf,
  hitStroke,
  InkPainter,
} from "./engine";
import { protectDrawingSurface } from "./gestures";
import { FramePainter } from "./frames";
import { parseScrollRequest, wheelScrollAmount } from "./scroll";
import {
  MAX_BATCH_POINTS,
  type InkEvent,
  type InkOp,
  type Point,
  type Stroke,
  type InkViewerSnapshot,
  type InkDimensions,
} from "./protocol";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Missing element: ${id}`);
  }
  return result as T;
}
const params = new URLSearchParams(location.search);
const overlay = params.get("overlay") === "1";
if (overlay) {
  document.body.classList.add("overlay");
}
let token =
  new URLSearchParams(location.hash.slice(1)).get("code") ??
  params.get("code") ??
  "";
const clientId =
  sessionStorage.getItem("oh-my-immersive-ink-client") ??
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
sessionStorage.setItem("oh-my-immersive-ink-client", clientId);
const canvas = element<HTMLCanvasElement>("ink");
const stage = element("stage");
const area = element("area");
const background = element<HTMLCanvasElement>("background");
const framePainter = new FramePainter(background);
protectDrawingSurface(area);
const status = element("status");
const painter = new InkPainter(canvas);
const strokeMap = new Map<string, Stroke>();
const pair = element("pair");
const pairError = element("pair-error");
const toolbar = element("toolbar");
const scrollUp = element<HTMLButtonElement>("scroll-up");
const scrollDown = element<HTMLButtonElement>("scroll-down");
let connected = false;
let revision = -1;
let frameWidth = 1280;
let frameHeight = 720;
let eventStream: EventSource | null = null;
let activeStroke: Stroke | null = null;
let activePointerId: number | null = null;
let tool: DrawingTool = DrawingTool.Pen;
let sentPointCount = 1;
let flushTimer: number | null = null;
let pendingEraseIds = new Set<string>();
let sendQueue = Promise.resolve();
let connectionGeneration = 0;
let scrollPending = 0;
let scrollTimer: number | null = null;
let scrolling = false;
let scrollAbort: AbortController | null = null;
const endpoint = (path: string) =>
  `${path}${path.includes("?") ? "&" : "?"}code=${encodeURIComponent(token)}`;

/** 当前本地笔迹单独绘制，避免与服务端回显重复叠加。 */
function render(): void {
  painter.rebuild(
    [...strokeMap.values()].filter((s) => s.id !== activeStroke?.id),
  );
  painter.live(activeStroke);
}

/** 让底图和书写层使用同一舞台比例，设备尺寸变化时一起调整。 */
function resize(): void {
  if (!overlay) {
    area.style.top = `${toolbar.getBoundingClientRect().height}px`;
    const bounds = area.getBoundingClientRect();
    const scale = Math.max(
      0.001,
      Math.min(
        (bounds.width - 24) / frameWidth,
        (bounds.height - 24) / frameHeight,
      ),
    );
    stage.style.width = `${frameWidth * scale}px`;
    stage.style.height = `${frameHeight * scale}px`;
  }
  const rect = stage.getBoundingClientRect();
  painter.resize(rect.width, rect.height);
  render();
}
new ResizeObserver(resize).observe(area);
new ResizeObserver(resize).observe(toolbar);
window.addEventListener("resize", resize);

/** 每次 SSE 连接先接收完整快照，再按 revision 顺序应用增量操作。 */
function connect(): void {
  if (!token) {
    pair.hidden = false;
    return;
  }
  pair.hidden = true;
  eventStream?.close();
  connected = false;
  cancelRemoteScroll();
  updateScrollControls();
  status.textContent = "连接中…";
  eventStream = new EventSource(
    endpoint(`${InkRoute.Events}?client=${clientId}`),
  );
  eventStream.addEventListener(InkStreamEvent.Snapshot, receiveSnapshot);
  eventStream.addEventListener(InkStreamEvent.Operation, receiveOperation);
  eventStream.addEventListener(InkStreamEvent.Dimensions, receiveDimensions);
  eventStream.onerror = () => {
    connected = false;
    cancelRemoteScroll();
    status.textContent = "连接中断，正在重连…";
    // EventSource's automatic reconnect receives an authoritative snapshot.
    cancelLocal();
  };
}

/** 连接初始化时用完整快照替换本地缓存，随后再接受增量事件。 */
function receiveSnapshot(event: Event): void {
  const data = JSON.parse(
    (event as MessageEvent<string>).data,
  ) as InkViewerSnapshot;
  strokeMap.clear();
  data.strokes.forEach((s) => strokeMap.set(s.id, s));
  activeStroke = null;
  activePointerId = null;
  revision = data.revision;
  frameWidth = data.width;
  frameHeight = data.height;
  connected = true;
  updateScrollControls();
  status.textContent = "已连接 · 笔尖 / 鼠标 · 触摸不落墨";
  resize();
}

/** 按服务端序号应用远端操作；自己的回显不覆盖本地尚未上传的采样点。 */
function receiveOperation(event: Event): void {
  const data = JSON.parse((event as MessageEvent<string>).data) as InkEvent;
  if (data.revision <= revision) {
    return;
  }
  // 事件有缺口时重新取快照，不猜测或跳过缺失的笔迹。
  if (data.revision !== revision + 1) {
    connect();
    return;
  }
  revision = data.revision;
  const op = data.op;
  if (op.t === InkOperationType.Begin) {
    // 本机已经即时绘制自己的操作，服务端回显不能覆盖尚未上传的点。
    if (op.stroke.owner !== clientId || !strokeMap.has(op.stroke.id)) {
      strokeMap.set(op.stroke.id, op.stroke);
    }
  } else if (op.t === InkOperationType.Append) {
    const s = strokeMap.get(op.id);
    if (s && s.owner !== clientId) {
      if (s.points.length !== op.offset) {
        connect();
        return;
      }
      s.points.push(...op.points);
    }
  } else if (op.t === InkOperationType.End) {
    const s = strokeMap.get(op.id);
    if (s) {
      s.complete = true;
    }
  } else if (
    op.t === InkOperationType.Delete ||
    op.t === InkOperationType.Cancel
  ) {
    const ids = op.t === InkOperationType.Delete ? op.ids : [op.id];
    ids.forEach((id) => strokeMap.delete(id));
    if (activeStroke && ids.includes(activeStroke.id)) {
      cancelLocal();
    }
  } else if (op.t === InkOperationType.Clear) {
    strokeMap.clear();
    cancelLocal();
  }
  render();
  updateScrollControls();
}

/** 窗口尺寸更新后，底图与笔迹共享新的舞台比例。 */
function receiveDimensions(event: Event): void {
  const data = JSON.parse(
    (event as MessageEvent<string>).data,
  ) as InkDimensions;
  frameWidth = data.width;
  frameHeight = data.height;
  resize();
}

/** 取消只丢弃当前未完成输入，已完成的笔迹仍由服务端快照管理。 */
function cancelLocal(): void {
  if (activeStroke) {
    strokeMap.delete(activeStroke.id);
  }
  activeStroke = null;
  activePointerId = null;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = null;
  pendingEraseIds.clear();
  updateScrollControls();
}

/** 只传垂直滚动，独立于笔迹队列；触摸仍由画布的防误触规则处理。 */
function updateScrollControls(): void {
  const drawing =
    activePointerId !== null ||
    [...strokeMap.values()].some((stroke) => !stroke.complete);
  const disabled = overlay || !connected || drawing;
  scrollUp.disabled = disabled;
  scrollDown.disabled = disabled;
}

function cancelRemoteScroll(): void {
  scrollPending = 0;
  if (scrollTimer !== null) {
    window.clearTimeout(scrollTimer);
    scrollTimer = null;
  }
  scrollAbort?.abort();
}

function queueScroll(amount: number): void {
  if (scrollUp.disabled || amount === 0) {
    return;
  }
  scrollPending = Math.max(-1, Math.min(1, scrollPending + amount));
  if (scrollTimer === null && !scrolling) {
    scrollTimer = window.setTimeout(() => {
      void flushScroll();
    }, 50);
  }
}

/** 每次发送前获取目标标识，再由宿主复核，避免迟到指令滚动另一篇笔记。 */
async function flushScroll(): Promise<void> {
  scrollTimer = null;
  if (scrollUp.disabled || scrollPending === 0) {
    scrollPending = 0;
    return;
  }
  const amount = scrollPending;
  scrollPending = 0;
  scrolling = true;
  const abort = new AbortController();
  scrollAbort = abort;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, 3000);
  const generation = connectionGeneration;
  try {
    const endpointURL = endpoint(InkRoute.Scroll);
    const stateResponse = await fetch(endpointURL, { signal: abort.signal });
    if (!stateResponse.ok) {
      throw new Error("无法读取笔记滚动状态");
    }
    const state = (await stateResponse.json()) as { target?: unknown };
    if (generation !== connectionGeneration || scrollUp.disabled) {
      return;
    }
    if (state.target === null) {
      status.textContent = "请在本机主窗口选中 Markdown 笔记后滚动";
      return;
    }
    const request = parseScrollRequest({ target: state.target, amount });
    const response = await fetch(endpointURL, {
      method: HttpMethod.Post,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: abort.signal,
    });
    if (!response.ok) {
      throw new Error("滚动回传失败");
    }
    const result = (await response.json()) as { result?: unknown };
    if (generation !== connectionGeneration || abort.signal.aborted) {
      return;
    }
    if (result.result === ScrollResult.Busy) {
      status.textContent = "书写中，已暂停滚动";
    } else if (result.result === ScrollResult.Stale) {
      status.textContent = "笔记已切换，请重新滚动";
      scrollPending = 0;
    } else if (result.result === ScrollResult.Unavailable) {
      status.textContent = "请在本机主窗口选中 Markdown 笔记后滚动";
    } else if (result.result === ScrollResult.Applied) {
      status.textContent = "已连接 · 上下滚动 · 触摸不落墨";
    } else {
      throw new Error("无效的滚动响应");
    }
  } catch {
    if (
      (!abort.signal.aborted || timedOut) &&
      generation === connectionGeneration
    ) {
      status.textContent = timedOut
        ? "滚动回传超时，请重试"
        : "滚动回传失败，请重试";
    }
    scrollPending = 0;
  } finally {
    window.clearTimeout(timeout);
    if (scrollAbort === abort) scrollAbort = null;
    scrolling = false;
    if (!scrollUp.disabled && scrollPending !== 0 && scrollTimer === null) {
      scrollTimer = window.setTimeout(() => {
        void flushScroll();
      }, 50);
    }
  }
}

scrollUp.addEventListener("click", () => queueScroll(-0.5));
scrollDown.addEventListener("click", () => queueScroll(0.5));
area.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    queueScroll(
      wheelScrollAmount(
        event.deltaY,
        event.deltaMode,
        stage.getBoundingClientRect().height,
      ),
    );
  },
  { passive: false },
);

/** 固定操作内容后串行发送，保证 Begin、Append、End 不会网络乱序。 */
function enqueue(op: InkOp): void {
  const body = JSON.stringify(op);
  const generation = connectionGeneration;
  sendQueue = sendQueue
    .then(async () => {
      if (generation !== connectionGeneration) {
        return;
      }
      const response = await fetch(endpoint(InkRoute.Operation), {
        method: HttpMethod.Post,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    })
    .catch((error: unknown) => {
      connectionGeneration++;
      cancelLocal();
      status.textContent = `同步失败：${error instanceof Error ? error.message : "请重新连接"}`;
      connect();
    });
}

/** offset 对应累计已上传的点数；一批最多使用协议允许的采样量。 */
function flush(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = null;
  if (activeStroke) {
    while (sentPointCount < activeStroke.points.length) {
      const pts = activeStroke.points.slice(
        sentPointCount,
        sentPointCount + MAX_BATCH_POINTS,
      );
      enqueue({
        t: InkOperationType.Append,
        id: activeStroke.id,
        offset: sentPointCount,
        points: pts,
      });
      sentPointCount += pts.length;
    }
  }
  if (pendingEraseIds.size) {
    enqueue({ t: InkOperationType.Delete, ids: [...pendingEraseIds] });
    pendingEraseIds.clear();
  }
}

function schedule(): void {
  if (flushTimer === null) {
    flushTimer = window.setTimeout(flush, 20);
  }
}

function point(event: PointerEvent): Point {
  return normalizedPoint(
    event.clientX,
    event.clientY,
    canvas.getBoundingClientRect(),
    pressureOf(event),
  );
}

function erase(event: PointerEvent): void {
  const pt = point(event),
    rect = canvas.getBoundingClientRect();
  for (const s of strokeMap.values()) {
    if (hitStroke(s, pt, rect.width, rect.height)) {
      strokeMap.delete(s.id);
      pendingEraseIds.add(s.id);
    }
  }
  schedule();
  render();
}
// 只接受一支活动指针；手掌触摸不能开始笔迹，也不能结束 Pencil 的输入。
canvas.addEventListener("pointerdown", (event) => {
  if (
    overlay ||
    !connected ||
    activePointerId !== null ||
    !acceptsPointer(event)
  ) {
    return;
  }
  event.preventDefault();
  cancelRemoteScroll();
  activePointerId = event.pointerId;
  updateScrollControls();
  canvas.setPointerCapture(activePointerId);
  if (tool === DrawingTool.Eraser) {
    erase(event);
    return;
  }
  activeStroke = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
    owner: clientId,
    tool,
    color: element<HTMLInputElement>("color").value,
    size: Number(element<HTMLInputElement>("size").value),
    points: [point(event)],
    complete: false,
  };
  strokeMap.set(activeStroke.id, activeStroke);
  sentPointCount = 1;
  enqueue({ t: InkOperationType.Begin, stroke: activeStroke });
  render();
});
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId) {
    return;
  }
  event.preventDefault();
  if (tool === DrawingTool.Eraser) {
    erase(event);
    return;
  }
  if (!activeStroke) {
    return;
  }
  // Safari 支持时使用合并采样点，保留快速移动时的完整曲线。
  const samples =
    typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];
  for (const sample of samples.length ? samples : [event]) {
    const pt = point(sample),
      last = activeStroke.points[activeStroke.points.length - 1];
    if (
      Math.hypot(
        (pt[0] - last[0]) * frameWidth,
        (pt[1] - last[1]) * frameHeight,
      ) > 0.35
    ) {
      activeStroke.points.push(pt);
    }
  }
  schedule();
  painter.live(activeStroke);
});
canvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePointerId) {
    return;
  }
  if (activeStroke) {
    activeStroke.points.push(point(event));
  }
  flush();
  if (activeStroke) {
    activeStroke.complete = true;
    enqueue({ t: InkOperationType.End, id: activeStroke.id });
  }
  activeStroke = null;
  activePointerId = null;
  updateScrollControls();
  render();
});

/** 系统中断与正常抬笔分开处理，取消的笔迹不会被误标为完成。 */
function cancelPointer(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }
  if (activeStroke) {
    enqueue({ t: InkOperationType.Cancel, id: activeStroke.id });
  }
  cancelLocal();
  render();
}
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("lostpointercapture", cancelPointer);
document
  .querySelectorAll<HTMLButtonElement>("[data-tool]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      if (activePointerId !== null) {
        return;
      }
      const selectedTool = parseDrawingTool(button.dataset.tool);
      if (selectedTool === null) {
        return;
      }
      tool = selectedTool;
      document
        .querySelectorAll("[data-tool]")
        .forEach((b) => b.classList.toggle("active", b === button));
    });
  });
element("undo").addEventListener("click", () => {
  if (!connected || activePointerId !== null) {
    return;
  }
  const last = [...strokeMap.values()]
    .reverse()
    .find((s) => s.owner === clientId && s.complete);
  if (last) {
    strokeMap.delete(last.id);
    enqueue({ t: InkOperationType.Delete, ids: [last.id] });
    render();
  }
});
element("clear").addEventListener("click", () => {
  if (!connected || activePointerId !== null) {
    return;
  }
  strokeMap.clear();
  enqueue({ t: InkOperationType.Clear });
  render();
});
element<HTMLFormElement>("pair-form").addEventListener("submit", (event) => {
  event.preventDefault();
  token = element<HTMLInputElement>("pair-code").value.trim();
  void fetch(endpoint(InkRoute.State))
    .then(async (response) => {
      if (!response.ok) {
        pairError.textContent = "连接码不正确，或服务已停止。";
        return;
      }
      location.hash = new URLSearchParams({ code: token }).toString();
      connect();
    })
    .catch(() => {
      pairError.textContent = "无法连接服务。";
    });
});
window.addEventListener("hashchange", () => {
  const next = new URLSearchParams(location.hash.slice(1)).get("code") ?? "";
  if (next === token) {
    return;
  }
  token = next;
  connectionGeneration++;
  cancelLocal();
  connect();
});

/** 下一帧解码完成前保留上一帧，底图更新与透明书写层相互独立。 */
async function nextFrame(): Promise<void> {
  if (!overlay && connected) {
    try {
      const response = await fetch(
        endpoint(`${InkRoute.Frame}?n=${Date.now()}`),
      );
      if (!response.ok) {
        throw new Error("Frame unavailable");
      }
      await framePainter.show(await response.blob());
      if (status.textContent === "底图暂不可用，等待本机窗口…") {
        status.textContent = "已连接 · 笔尖 / 鼠标 · 触摸不落墨";
      }
    } catch {
      status.textContent = "底图暂不可用，等待本机窗口…";
    }
  }
  window.setTimeout(() => {
    void nextFrame();
  }, 350);
}
connect();
resize();
void nextFrame();
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    cancelRemoteScroll();
    framePainter.destroy();
  }
});

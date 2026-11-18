import { acceptsPointer, normalizedPoint, pressureOf, hitStroke, InkPainter } from "./engine";
import { protectDrawingSurface } from "./gestures";
import { FramePainter } from "./frames";
import type { InkEvent, InkOp, Point, Stroke, InkSnapshot } from "./protocol";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}
const params = new URLSearchParams(location.search);
const overlay = params.get("overlay") === "1";
if (overlay) document.body.classList.add("overlay");
let token = new URLSearchParams(location.hash.slice(1)).get("code") ?? params.get("code") ?? "";
const client = sessionStorage.getItem("immersive-folder-ink-client") ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
sessionStorage.setItem("immersive-folder-ink-client", client);
const canvas = element<HTMLCanvasElement>("ink");
const stage = element("stage");
const area = element("area");
const background = element<HTMLCanvasElement>("background");
const framePainter = new FramePainter(background);
protectDrawingSurface(area);
const status = element("status");
const painter = new InkPainter(canvas);
const strokes = new Map<string, Stroke>();
const pair = element("pair");
const pairError = element("pair-error");
const toolbar = element("toolbar");
let connected = false;
let revision = -1;
let frameWidth = 1280;
let frameHeight = 720;
let source: EventSource | null = null;
let live: Stroke | null = null;
let pointer: number | null = null;
let tool: "pen" | "marker" | "eraser" = "pen";
let sent = 1;
let batch: number | null = null;
let erased = new Set<string>();
let chain = Promise.resolve();
let epoch = 0;

const endpoint = (path: string) => `${path}${path.includes("?") ? "&" : "?"}code=${encodeURIComponent(token)}`;
function render(): void {
  painter.rebuild([...strokes.values()].filter(s => s.id !== live?.id));
  painter.live(live);
}
function resize(): void {
  if (!overlay) {
    area.style.top = `${toolbar.getBoundingClientRect().height}px`;
    const bounds = area.getBoundingClientRect();
    const scale = Math.max(0.001, Math.min((bounds.width - 24) / frameWidth, (bounds.height - 24) / frameHeight));
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

function connect(): void {
  if (!token) { pair.hidden = false; return; }
  pair.hidden = true;
  source?.close();
  connected = false;
  status.textContent = "连接中…";
  source = new EventSource(endpoint(`/events?client=${client}`));
  source.addEventListener("snapshot", event => {
    const data = JSON.parse((event as MessageEvent<string>).data) as InkSnapshot & { width: number; height: number };
    strokes.clear();
    data.strokes.forEach(s => strokes.set(s.id, s));
    live = null;
    pointer = null;
    revision = data.revision;
    frameWidth = data.width;
    frameHeight = data.height;
    connected = true;
    status.textContent = "已连接 · 笔尖 / 鼠标 · 触摸不落墨";
    resize();
  });
  source.addEventListener("op", event => {
    const data = JSON.parse((event as MessageEvent<string>).data) as InkEvent;
    if (data.revision <= revision) return;
    if (data.revision !== revision + 1) { connect(); return; }
    revision = data.revision;
    const op = data.op;
    if (op.t === "begin") {
      if (op.stroke.owner !== client || !strokes.has(op.stroke.id)) strokes.set(op.stroke.id, op.stroke);
    } else if (op.t === "append") {
      const s = strokes.get(op.id);
      if (s && s.owner !== client) {
        if (s.points.length !== op.offset) { connect(); return; }
        s.points.push(...op.points);
      }
    } else if (op.t === "end") {
      const s = strokes.get(op.id);
      if (s) s.complete = true;
    } else if (op.t === "delete" || op.t === "cancel") {
      const ids = op.t === "delete" ? op.ids : [op.id];
      ids.forEach(id => strokes.delete(id));
      if (live && ids.includes(live.id)) cancelLocal();
    } else if (op.t === "clear") { strokes.clear(); cancelLocal(); }
    render();
  });
  source.addEventListener("dimensions", event => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { width: number; height: number };
    frameWidth = data.width; frameHeight = data.height; resize();
  });
  source.onerror = () => {
    connected = false;
    status.textContent = "连接中断，正在重连…";
    // EventSource's automatic reconnect receives an authoritative snapshot.
    cancelLocal();
  };
}
function cancelLocal(): void {
  if (live) strokes.delete(live.id);
  live = null; pointer = null;
  if (batch !== null) window.clearTimeout(batch);
  batch = null;
  erased.clear();
}
function enqueue(op: InkOp): void {
  const body = JSON.stringify(op);
  const generation = epoch;
  chain = chain.then(async () => {
    if (generation !== epoch) return;
    const response = await fetch(endpoint("/api/op"), { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!response.ok) throw new Error(await response.text());
  }).catch((error: unknown) => {
    epoch++;
    cancelLocal();
    status.textContent = `同步失败：${error instanceof Error ? error.message : "请重新连接"}`;
    connect();
  });
}
function flush(): void {
  if (batch !== null) window.clearTimeout(batch);
  batch = null;
  if (live) {
    while (sent < live.points.length) {
      const pts = live.points.slice(sent, sent + 2048);
      enqueue({ t: "append", id: live.id, offset: sent, points: pts });
      sent += pts.length;
    }
  }
  if (erased.size) {
    enqueue({ t: "delete", ids: [...erased] });
    erased.clear();
  }
}
function schedule(): void { if (batch === null) batch = window.setTimeout(flush, 20); }
function point(event: PointerEvent): Point {
  return normalizedPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), pressureOf(event));
}
function erase(event: PointerEvent): void {
  const pt = point(event), rect = canvas.getBoundingClientRect();
  for (const s of strokes.values()) {
    if (hitStroke(s, pt, rect.width, rect.height)) {
      strokes.delete(s.id); erased.add(s.id);
    }
  }
  schedule(); render();
}
canvas.addEventListener("pointerdown", event => {
  if (overlay || !connected || pointer !== null || !acceptsPointer(event)) return;
  event.preventDefault();
  pointer = event.pointerId;
  canvas.setPointerCapture(pointer);
  if (tool === "eraser") { erase(event); return; }
  live = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
    owner: client, tool, color: element<HTMLInputElement>("color").value,
    size: Number(element<HTMLInputElement>("size").value), points: [point(event)], complete: false,
  };
  strokes.set(live.id, live);
  sent = 1;
  enqueue({ t: "begin", stroke: live });
  render();
});
canvas.addEventListener("pointermove", event => {
  if (event.pointerId !== pointer) return;
  event.preventDefault();
  if (tool === "eraser") { erase(event); return; }
  if (!live) return;
  const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  for (const sample of samples.length ? samples : [event]) {
    const pt = point(sample), last = live.points[live.points.length - 1];
    if (Math.hypot((pt[0] - last[0]) * frameWidth, (pt[1] - last[1]) * frameHeight) > 0.35) live.points.push(pt);
  }
  schedule();
  painter.live(live);
});
canvas.addEventListener("pointerup", event => {
  if (event.pointerId !== pointer) return;
  if (live) live.points.push(point(event));
  flush();
  if (live) { live.complete = true; enqueue({ t: "end", id: live.id }); }
  live = null; pointer = null;
  render();
});
function cancelPointer(event: PointerEvent): void {
  if (event.pointerId !== pointer) return;
  if (live) enqueue({ t: "cancel", id: live.id });
  cancelLocal(); render();
}
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("lostpointercapture", cancelPointer);
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => {
  button.addEventListener("click", () => {
    if (pointer !== null) return;
    tool = button.dataset.tool as typeof tool;
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b === button));
  });
});
element("undo").addEventListener("click", () => {
  if (!connected || pointer !== null) return;
  const last = [...strokes.values()].reverse().find(s => s.owner === client && s.complete);
  if (last) { strokes.delete(last.id); enqueue({ t: "delete", ids: [last.id] }); render(); }
});
element("clear").addEventListener("click", () => {
  if (!connected || pointer !== null) return;
  strokes.clear(); enqueue({ t: "clear" }); render();
});
element<HTMLFormElement>("pair-form").addEventListener("submit", event => {
  event.preventDefault();
  token = element<HTMLInputElement>("pair-code").value.trim();
  void fetch(endpoint("/api/state")).then(async response => {
    if (!response.ok) { pairError.textContent = "连接码不正确，或服务已停止。"; return; }
    location.hash = new URLSearchParams({ code: token }).toString();
    connect();
  }).catch(() => { pairError.textContent = "无法连接服务。"; });
});
window.addEventListener("hashchange", () => {
  const next = new URLSearchParams(location.hash.slice(1)).get("code") ?? "";
  if (next === token) return;
  token = next;
  epoch++;
  cancelLocal();
  connect();
});

async function nextFrame(): Promise<void> {
  if (!overlay && connected) {
    try {
      const response = await fetch(endpoint(`/frame?n=${Date.now()}`));
      if (!response.ok) throw new Error("Frame unavailable");
      await framePainter.show(await response.blob());
      if (status.textContent === "底图暂不可用，等待本机窗口…") status.textContent = "已连接 · 笔尖 / 鼠标 · 触摸不落墨";
    } catch { status.textContent = "底图暂不可用，等待本机窗口…"; }
  }
  window.setTimeout(() => { void nextFrame(); }, 350);
}
connect();
resize();
void nextFrame();
window.addEventListener("pagehide", event => { if (!event.persisted) framePainter.destroy(); });

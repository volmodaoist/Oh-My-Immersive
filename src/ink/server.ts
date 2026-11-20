import {
  HttpMethod,
  InkRoute,
  InkStreamEvent,
  InkOperationType,
  parseHttpMethod,
  parseInkRoute,
} from "./enums";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Buffer } from "node:buffer";
import * as timers from "node:timers";
import {
  InkStore,
  parseOp,
  type ClearInkOperation,
  type CancelStrokeOperation,
} from "./protocol";
import { INK_PAGE } from "./page";
import clientSource from "remote-ink-client";

export interface InkServerHost {
  frame(): Promise<Uint8Array>;
}

/** 只共享当前画面与内存笔迹；状态端点需要本次服务的随机连接码。 */
export class InkServer {
  readonly store = new InkStore();
  readonly code = randomBytes(12).toString("hex");
  private server: Server | null = null;
  private readonly viewers = new Set<ServerResponse>();
  private width = 1280;
  private height = 720;
  port = 0;
  constructor(private readonly host: InkServerHost) {}
  async start(port: number): Promise<void> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    this.port =
      typeof address === "object" && address !== null ? address.port : port;
  }

  localURL(overlay = false): string {
    return `http://127.0.0.1:${this.port}/${overlay ? "?overlay=1" : ""}#code=${this.code}`;
  }

  urls(): string[] {
    const interfaces = networkInterfaces();
    const addresses = new Set<string>();
    for (const name of Object.keys(interfaces).sort(
      (a, b) => Number(!a.startsWith("en")) - Number(!b.startsWith("en")),
    )) {
      for (const address of interfaces[name] ?? []) {
        if (
          address.family === "IPv4" &&
          !address.internal &&
          !name.startsWith("utun")
        ) {
          addresses.add(address.address);
        }
      }
    }
    return [...addresses].map(
      (ip) => `http://${ip}:${this.port}/#code=${this.code}`,
    );
  }

  dimensions(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.broadcast(InkStreamEvent.Dimensions, { width, height });
  }

  clear(): void {
    const op: ClearInkOperation = { t: InkOperationType.Clear };
    if (this.store.apply(op)) {
      this.broadcast(InkStreamEvent.Operation, {
        revision: this.store.revision,
        op,
      });
    }
  }

  /** 停服主动断开所有 HTTP 连接，不等待截图完成或客户端上传剩余内容。 */
  async stop(): Promise<void> {
    this.clear();
    const server = this.server;
    this.server = null;
    for (const viewer of this.viewers) {
      viewer.end();
    }
    this.viewers.clear();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // close() 停止接收新连接；随后连同正在处理请求的连接一起关闭。
        // 只关闭空闲连接会让未完成的截图、上传或慢客户端一直拖住停服。
        server.closeAllConnections();
      });
    }
  }

  private respond(
    res: ServerResponse,
    status: number,
    type: string,
    body: string | Uint8Array,
  ): void {
    // 截图可能在停服后才返回；已关闭的响应不再尝试写入。
    if (res.destroyed || res.writableEnded) {
      return;
    }
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(body);
  }
  /** 慢客户端的缓冲有界，断开后客户端会通过完整快照恢复。 */
  private broadcast(event: InkStreamEvent, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const viewer of this.viewers) {
      if (viewer.writableLength > 1048576) {
        viewer.destroy();
        continue;
      }
      viewer.write(message);
    }
  }
  /** 静态入口公开，画面、状态和写入操作均在连接码及来源检查之后处理。 */
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? InkRoute.Page, "http://localhost");
      const method = parseHttpMethod(req.method);
      const route = parseInkRoute(url.pathname);
      if (method === HttpMethod.Get && route === InkRoute.Page) {
        this.respond(res, 200, "text/html; charset=utf-8", INK_PAGE);
        return;
      }
      if (method === HttpMethod.Get && route === InkRoute.Client) {
        this.respond(res, 200, "text/javascript; charset=utf-8", clientSource);
        return;
      }
      if (url.searchParams.get("code") !== this.code) {
        this.respond(res, 401, "text/plain; charset=utf-8", "连接码不正确");
        return;
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        this.respond(res, 403, "text/plain", "Origin mismatch");
        return;
      }
      if (method === HttpMethod.Get && route === InkRoute.State) {
        this.respond(
          res,
          200,
          "application/json",
          JSON.stringify({
            ...this.store.snapshot(),
            width: this.width,
            height: this.height,
          }),
        );
      } else if (method === HttpMethod.Get && route === InkRoute.Events) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        this.viewers.add(res);
        res.write(
          `event: ${InkStreamEvent.Snapshot}\ndata: ${JSON.stringify({ ...this.store.snapshot(), width: this.width, height: this.height })}\n\n`,
        );
        // 心跳维持 SSE 连接；断线时丢弃该客户端尚未抬笔的临时内容。
        const heartbeat = timers.setInterval(() => {
          res.write(": ping\n\n");
        }, 15000);
        const client = url.searchParams.get("client");
        res.on("close", () => {
          timers.clearInterval(heartbeat);
          this.viewers.delete(res);
          if (client) {
            for (const stroke of this.store.strokes.values()) {
              if (stroke.owner === client && !stroke.complete) {
                const op: CancelStrokeOperation = {
                  t: InkOperationType.Cancel,
                  id: stroke.id,
                };
                if (this.store.apply(op)) {
                  this.broadcast(InkStreamEvent.Operation, {
                    revision: this.store.revision,
                    op,
                  });
                }
              }
            }
          }
        });
      } else if (method === HttpMethod.Get && route === InkRoute.Frame) {
        this.respond(res, 200, "image/jpeg", await this.host.frame());
      } else if (method === HttpMethod.Post && route === InkRoute.Operation) {
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          throw new Error("请求必须为 JSON");
        }
        // 限制请求体大小，避免异常客户端让笔迹服务无限分配内存。
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
          size += buffer.length;
          if (size > 196608) {
            throw new Error("笔迹请求过大");
          }
          chunks.push(buffer);
        }
        const op = parseOp(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
        if (this.store.apply(op)) {
          this.broadcast(InkStreamEvent.Operation, {
            revision: this.store.revision,
            op,
          });
        }
        this.respond(
          res,
          200,
          "application/json",
          JSON.stringify({ revision: this.store.revision }),
        );
      } else {
        this.respond(res, 404, "text/plain", "Not found");
      }
    } catch (error: unknown) {
      if (!res.headersSent) {
        this.respond(
          res,
          400,
          "text/plain; charset=utf-8",
          error instanceof Error ? error.message : "请求失败",
        );
      } else {
        res.end();
      }
    }
  }
}

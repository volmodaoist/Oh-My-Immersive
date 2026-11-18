import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Buffer } from "node:buffer";
import * as timers from "node:timers";
import { InkStore, parseOp } from "./protocol";
import { INK_PAGE } from "./page";
import clientSource from "remote-ink-client";

export interface InkServerHost {
  frame(): Promise<Uint8Array>;
}
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
    const server = createServer((req, res) => { void this.handle(req, res); });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    this.port = typeof address === "object" && address !== null ? address.port : port;
  }

  localURL(overlay = false): string {
    return `http://127.0.0.1:${this.port}/${overlay ? "?overlay=1" : ""}#code=${this.code}`;
  }
  urls(): string[] {
    const interfaces = networkInterfaces();
    const addresses = new Set<string>();
    for (const name of Object.keys(interfaces).sort((a, b) => Number(!a.startsWith("en")) - Number(!b.startsWith("en")))) {
      for (const address of interfaces[name] ?? []) {
        if (address.family === "IPv4" && !address.internal && !name.startsWith("utun")) addresses.add(address.address);
      }
    }
    return [...addresses].map(ip => `http://${ip}:${this.port}/#code=${this.code}`);
  }

  dimensions(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.broadcast("dimensions", { width, height });
  }

  clear(): void {
    const op = { t: "clear" as const };
    if (this.store.apply(op)) this.broadcast("op", { revision: this.store.revision, op });
  }

  async stop(): Promise<void> {
    this.clear();
    const server = this.server;
    this.server = null;
    for (const viewer of this.viewers) viewer.end();
    this.viewers.clear();
    if (server) {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    }
  }

  private respond(res: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(body);
  }
  private broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const viewer of this.viewers) {
      if (viewer.writableLength > 1048576) { viewer.destroy(); continue; }
      viewer.write(message);
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        this.respond(res, 200, "text/html; charset=utf-8", INK_PAGE); return;
      }
      if (req.method === "GET" && url.pathname === "/client.js") {
        this.respond(res, 200, "text/javascript; charset=utf-8", clientSource); return;
      }
      if (url.searchParams.get("code") !== this.code) { this.respond(res, 401, "text/plain; charset=utf-8", "连接码不正确"); return; }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { this.respond(res, 403, "text/plain", "Origin mismatch"); return; }
      if (req.method === "GET" && url.pathname === "/api/state") {
        this.respond(res, 200, "application/json", JSON.stringify({ ...this.store.snapshot(), width: this.width, height: this.height }));
      } else if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive" });
        this.viewers.add(res);
        res.write(`event: snapshot\ndata: ${JSON.stringify({ ...this.store.snapshot(), width: this.width, height: this.height })}\n\n`);
        const heartbeat = timers.setInterval(() => { res.write(": ping\n\n"); }, 15000);
        const client = url.searchParams.get("client");
        res.on("close", () => {
          timers.clearInterval(heartbeat); this.viewers.delete(res);
          if (client) {
            for (const stroke of this.store.strokes.values()) {
              if (stroke.owner === client && !stroke.complete) {
                const op = { t: "cancel" as const, id: stroke.id };
                if (this.store.apply(op)) this.broadcast("op", { revision: this.store.revision, op });
              }
            }
          }
        });
      } else if (req.method === "GET" && url.pathname === "/frame") {
        this.respond(res, 200, "image/jpeg", await this.host.frame());
      } else if (req.method === "POST" && url.pathname === "/api/op") {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("请求必须为 JSON");
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          size += buffer.length;
          if (size > 196608) throw new Error("笔迹请求过大");
          chunks.push(buffer);
        }
        const op = parseOp(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        if (this.store.apply(op)) {
          this.broadcast("op", { revision: this.store.revision, op });
        }
        this.respond(res, 200, "application/json", JSON.stringify({ revision: this.store.revision }));
      } else { this.respond(res, 404, "text/plain", "Not found"); }
    } catch (error: unknown) {
      if (!res.headersSent) this.respond(res, 400, "text/plain; charset=utf-8", error instanceof Error ? error.message : "请求失败");
      else res.end();
    }
  }
}

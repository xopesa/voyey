import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export function createWebhookServer(
  handler: (request: Request) => Promise<Response>,
  secret: string,
  maxBytes = 1024 * 1024,
) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    throw new Error("Invalid Telegram webhook secret");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = digest(secret);
  async function handle(request: IncomingMessage, reply: ServerResponse) {
    reply.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/health") {
      reply.writeHead(200, { "Content-Type": "application/json" });
      reply.end(JSON.stringify({ status: "ok", service: "stenzo-bot" }));
      return;
    }
    if (request.url !== "/telegram/webhook") {
      reply.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      reply.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const supplied = request.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(expected, digest(supplied))
    ) {
      reply.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        reply.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      JSON.parse(body);
    } catch {
      reply.writeHead(400).end();
      return;
    }
    const response = await handler(
      new Request("https://bot.internal/telegram/webhook", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": supplied,
        },
      }),
    );
    reply.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") ?? "text/plain",
    });
    reply.end(Buffer.from(await response.arrayBuffer()));
  }
  const server = createServer((request, reply) => {
    void handle(request, reply).catch(() => {
      // No update body, request headers or token in logs/errors.
      if (!reply.headersSent) reply.writeHead(500);
      reply.end();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

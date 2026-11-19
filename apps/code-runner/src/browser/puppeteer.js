import puppeteer from "@cloudflare/puppeteer";
import { close, open, receive, send } from "codemode:browser";

export * from "@cloudflare/puppeteer";
export default puppeteer;

const SESSION_PATH = /^\/v1\/devtools\/browser\/([0-9a-f-]{36})$/;

function socketFor(sessionId) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  let closed = false;
  let outbox = [];
  let flushing = null;
  const fail = () => {
    if (closed) return;
    closed = true;
    server.close(1011, "the browser connection failed");
  };
  const flush = async () => {
    while (outbox.length > 0 && !closed) {
      const batch = outbox;
      outbox = [];
      await send(sessionId, batch);
    }
    flushing = null;
  };
  server.addEventListener("message", (event) => {
    outbox.push(String(event.data));
    flushing ??= Promise.resolve().then(flush).catch(fail);
  });
  server.addEventListener("close", () => {
    if (closed) return;
    closed = true;
    close(sessionId).catch(() => undefined);
  });
  (async () => {
    while (!closed) {
      const { messages, done } = await receive(sessionId);
      for (const message of messages) if (!closed) server.send(message);
      if (done) {
        if (!closed) {
          closed = true;
          server.close(1000, "the browser closed");
        }
        return;
      }
    }
  })().catch(fail);
  return client;
}

export const BROWSER = Object.freeze({
  async fetch(url, init = {}) {
    const { pathname } = new URL(typeof url === "string" ? url : url.url);
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "POST" && pathname === "/v1/devtools/browser") {
      return Response.json({ sessionId: await open() });
    }
    const session = SESSION_PATH.exec(pathname);
    const upgrade = new Headers(init.headers).get("upgrade");
    if (session && upgrade?.toLowerCase() === "websocket") {
      return new Response(null, { status: 101, webSocket: socketFor(session[1]) });
    }
    return Response.json({ error: `${pathname} is not available here. Use puppeteer.launch(env.BROWSER).` }, { status: 404 });
  },
});

globalThis.env = Object.assign(globalThis.env ?? {}, { BROWSER });

import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Guard } from "./cdp-guard.mjs";
import { startDenyProxy } from "./deny-proxy.mjs";
import { writeFontConfig } from "./fonts.mjs";
import { LIMITS } from "./limits.mjs";
import { Session } from "./session.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_PATH = /^\/v1\/devtools\/browser\/([0-9a-f-]{36})$/;
const SETUP_TIMEOUT_MS = 15_000;

export const FONT_DIRS = [join(ROOT, "node_modules", "source-sans", "TTF"), join(ROOT, "node_modules", "source-code-pro", "TTF"), "/usr/share/fonts"];
export const ASSETS = {
  "/mermaid.min.js": { file: join(ROOT, "node_modules", "mermaid", "dist", "mermaid.min.js"), type: "text/javascript" },
};

async function loadAssets() {
  const assets = new Map();
  for (const [path, { file, type }] of Object.entries(ASSETS)) assets.set(path, { type, base64: (await readFile(file)).toString("base64") });
  return assets;
}

function send(res, status, body) {
  const payload = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", "content-length": payload.length });
  res.end(payload);
}

function log(fields) {
  console.log(JSON.stringify(fields));
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function startRenderer({ port, host, chrome, sessions: maxSessions = LIMITS.sessions, workRoot, limits = LIMITS }) {
  if (!chrome) throw new Error("No browser: set BROWSER_RENDERER_CHROME to the chrome-headless-shell binary.");
  await access(chrome);
  const root = workRoot ?? (await mkdtemp(join(tmpdir(), "browser-renderer-")));
  await mkdir(root, { recursive: true });
  const fontConfig = await writeFontConfig(root, FONT_DIRS);
  const assets = await loadAssets();
  const proxy = await startDenyProxy();
  const sessions = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.messageBytes, perMessageDeflate: false });

  async function end(session, reason) {
    if (session.ending) return;
    session.ending = true;
    clearTimeout(session.connectTimer);
    clearTimeout(session.lifeTimer);
    session.socket?.close(1000, reason.slice(0, 120));
    await session.close();
    sessions.delete(session.id);
    log({
      message: "browser session ended",
      reason,
      ms: Date.now() - session.started,
      outputBytes: session.guard.outputBytes,
      refused: session.guard.refused.length,
      sessions: sessions.size,
    });
  }

  async function launch() {
    const session = new Session({ id: randomUUID(), chrome, proxyPort: proxy.port, fontConfig, workRoot: root });
    session.guard = new Guard(limits, { toBrowser: (text) => session.send(text), assets });
    session.onmessage = (text) => session.guard.fromBrowser(text);
    sessions.set(session.id, session);
    const exited = new Promise((_, reject) => {
      session.onexit = () => {
        reject(new Error("The browser exited while starting"));
        void end(session, "the browser exited");
      };
    });
    exited.catch(() => undefined);
    try {
      await session.start();
      await withTimeout(Promise.race([session.guard.setup(), exited]), SETUP_TIMEOUT_MS, "Starting the browser");
    } catch (error) {
      const detail = session.stderr.trim().split("\n").slice(-3).join(" | ");
      await end(session, `start failed: ${error.message}`);
      throw new Error(`${error.message}${detail ? `: ${detail}` : ""}`);
    }
    session.lifeTimer = setTimeout(() => void end(session, "the session ran past its time limit"), limits.sessionMs);
    return session;
  }

  async function acquire(res) {
    if (sessions.size >= maxSessions) return send(res, 503, { error: "busy" });
    let session;
    try {
      session = await launch();
    } catch (error) {
      log({ message: "browser did not start", error: error.message });
      return send(res, 500, { error: "The browser did not start." });
    }
    session.connectTimer = setTimeout(() => void end(session, "no connection"), limits.connectWithinMs);
    send(res, 200, { sessionId: session.id });
  }

  function connect(req, socket, head) {
    const { pathname } = new URL(req.url, "http://renderer");
    const session = sessions.get(SESSION_PATH.exec(pathname)?.[1]);
    if (!session || session.socket || session.ending) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clearTimeout(session.connectTimer);
      session.socket = ws;
      session.guard.toClient = (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      };
      ws.on("message", (data, isBinary) => {
        if (isBinary) return void end(session, "a binary message");
        const verdict = session.guard.command(data.toString("utf8"));
        if (verdict.reply) ws.send(verdict.reply);
        if (verdict.close) return void end(session, verdict.close);
        if (verdict.forward) session.send(verdict.forward);
      });
      ws.on("close", () => void end(session, "the client closed"));
      ws.on("error", () => void end(session, "the socket failed"));
    });
  }

  const selfTest = await launch();
  await end(selfTest, "self-test");

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://renderer");
    if (pathname === "/health") return req.method === "GET" ? send(res, 200, "ok") : send(res, 405, { error: "Use GET." });
    if (pathname === "/v1/devtools/browser") return req.method === "POST" ? void acquire(res) : send(res, 405, { error: "Use POST." });
    const session = sessions.get(SESSION_PATH.exec(pathname)?.[1]);
    if (session && req.method === "DELETE") {
      void end(session, "deleted");
      return send(res, 200, { closed: true });
    }
    send(res, 404, { error: "Not found. POST /v1/devtools/browser, then open a WebSocket to /v1/devtools/browser/<sessionId>." });
  });
  server.on("upgrade", connect);
  await new Promise((resolve) => server.listen(port, host, resolve));

  return {
    port: server.address().port,
    get sessions() {
      return sessions.size;
    },
    get proxyRefused() {
      return proxy.refused;
    },
    sessionList: () => [...sessions.values()],
    async close() {
      await Promise.all([...sessions.values()].map((session) => end(session, "shutdown")));
      await new Promise((resolve) => server.close(resolve));
      await proxy.close();
      if (!workRoot) await rm(root, { recursive: true, force: true });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const renderer = await startRenderer({
    port: Number(process.env.PORT ?? 9222),
    host: process.env.HOST ?? "0.0.0.0",
    chrome: process.env.BROWSER_RENDERER_CHROME,
    sessions: Number(process.env.BROWSER_RENDERER_SESSIONS ?? LIMITS.sessions),
    workRoot: process.env.BROWSER_RENDERER_WORK_DIR,
  });
  log({ message: "browser renderer listening", port: renderer.port, chrome: process.env.BROWSER_RENDERER_CHROME });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, async () => {
      await renderer.close();
      process.exit(0);
    });
  }
}

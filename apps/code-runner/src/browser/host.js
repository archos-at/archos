const ORIGIN = "http://browser-renderer";
const RECEIVE_WAIT_MS = 15_000;
export const BROWSERS_PER_RUN = 2;

export class BrowserUnavailable extends Error {}

export function browserHost(env) {
  const sockets = new Map();
  const state = { busy: false, opened: 0 };

  function socketOf(sessionId) {
    const entry = sockets.get(String(sessionId));
    if (!entry) throw new Error("This browser is closed. Launch a new one with puppeteer.launch(env.BROWSER).");
    return entry;
  }

  async function open() {
    if (!env.BROWSER_RENDERER_ADDR) {
      throw new BrowserUnavailable("This runner has no browser: Puppeteer is not available in this deployment.");
    }
    if (state.opened >= BROWSERS_PER_RUN) {
      throw new Error(`A run may launch at most ${BROWSERS_PER_RUN} browsers. Reuse one browser and open pages in it.`);
    }
    state.opened += 1;
    const acquired = await env.BROWSER_RENDERER.fetch(`${ORIGIN}/v1/devtools/browser`, { method: "POST" });
    if (acquired.status === 503) {
      state.busy = true;
      throw new BrowserUnavailable("busy: every browser is in use.");
    }
    if (!acquired.ok) throw new BrowserUnavailable(`The browser did not start (${acquired.status}).`);
    const { sessionId } = await acquired.json();
    const upgraded = await env.BROWSER_RENDERER.fetch(`${ORIGIN}/v1/devtools/browser/${sessionId}`, { headers: { Upgrade: "websocket" } });
    const ws = upgraded.webSocket;
    if (!ws) throw new BrowserUnavailable(`The browser did not accept the connection (${upgraded.status}).`);
    ws.accept();
    const entry = { ws, queue: [], wake: null, done: false };
    const wake = () => {
      entry.wake?.();
      entry.wake = null;
    };
    ws.addEventListener("message", (event) => {
      entry.queue.push(String(event.data));
      wake();
    });
    for (const type of ["close", "error"]) {
      ws.addEventListener(type, () => {
        entry.done = true;
        wake();
      });
    }
    sockets.set(sessionId, entry);
    return sessionId;
  }

  async function send([sessionId, messages]) {
    const entry = socketOf(sessionId);
    if (entry.done) throw new Error("The browser has closed.");
    for (const message of messages) entry.ws.send(String(message));
    return null;
  }

  async function receive([sessionId]) {
    const entry = socketOf(sessionId);
    if (entry.queue.length === 0 && !entry.done) {
      await new Promise((resolve) => {
        entry.wake = resolve;
        setTimeout(resolve, RECEIVE_WAIT_MS);
      });
    }
    const messages = entry.queue;
    entry.queue = [];
    return { messages, done: entry.done };
  }

  function closeOne(sessionId) {
    const entry = sockets.get(sessionId);
    if (!entry) return;
    sockets.delete(sessionId);
    entry.done = true;
    entry.wake?.();
    try {
      entry.ws.close(1000, "the run ended");
    } catch {
      return;
    }
  }

  return {
    state,
    module: {
      open: () => open(),
      send,
      receive,
      close: async ([sessionId]) => {
        closeOne(String(sessionId));
        return null;
      },
    },
    closeAll() {
      for (const sessionId of [...sockets.keys()]) closeOne(sessionId);
    },
  };
}

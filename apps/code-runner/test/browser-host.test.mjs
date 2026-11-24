import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_QUEUED_BYTES, browserHost } from "../src/browser/host.js";

function fakeRenderer() {
  const listeners = {};
  const socket = {
    closed: null,
    sent: [],
    accept() {},
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    send(message) {
      this.sent.push(message);
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
    emit(type, event) {
      for (const listener of listeners[type] ?? []) listener(event);
    },
  };
  const env = {
    BROWSER_RENDERER_ADDR: "10.0.0.1:9222",
    BROWSER_RENDERER: {
      async fetch(url) {
        if (url.endsWith("/v1/devtools/browser")) return Response.json({ sessionId: "00000000-0000-0000-0000-000000000000" });
        return { status: 101, webSocket: socket };
      },
    },
  };
  return { env, socket };
}

test("the host module relays messages both ways", async () => {
  const { env, socket } = fakeRenderer();
  const host = browserHost(env);
  const id = await host.module.open([]);
  await host.module.send([id, ["one", "two"]]);
  assert.deepEqual(socket.sent, ["one", "two"]);
  socket.emit("message", { data: "reply" });
  assert.deepEqual(await host.module.receive([id]), { messages: ["reply"], done: false });
  host.closeAll();
  assert.equal(socket.closed.code, 1000);
});

test("a browser that sends more than the queue holds, unread, is closed and the run told", async () => {
  const { env, socket } = fakeRenderer();
  const host = browserHost(env);
  const id = await host.module.open([]);
  const chunk = "x".repeat(8 * 1024 * 1024);
  for (let sent = 0; sent <= MAX_QUEUED_BYTES; sent += chunk.length) socket.emit("message", { data: chunk });
  assert.equal(socket.closed.code, 1009);
  await assert.rejects(host.module.receive([id]), /more than \d+ bytes the run has not read/);
});

test("a run without a browser address is told there is no browser", async () => {
  const host = browserHost({});
  await assert.rejects(host.module.open([]), /no browser/);
});

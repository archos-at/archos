import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { allowedMethods } from "../src/cdp-allowlist.mjs";
import { Guard, namesFileUrl } from "../src/cdp-guard.mjs";
import { LIMITS } from "../src/limits.mjs";

const require = createRequire(import.meta.url);

const EXPECTED = [
  "Audits.enable",
  "Browser.close",
  "Browser.getVersion",
  "DOM.describeNode",
  "DOM.resolveNode",
  "Emulation.setDefaultBackgroundColorOverride",
  "Emulation.setDeviceMetricsOverride",
  "Emulation.setEmulatedMedia",
  "Emulation.setTouchEmulationEnabled",
  "IO.close",
  "IO.read",
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.dispatchTouchEvent",
  "Input.insertText",
  "Log.enable",
  "Network.enable",
  "Page.addScriptToEvaluateOnNewDocument",
  "Page.captureScreenshot",
  "Page.createIsolatedWorld",
  "Page.enable",
  "Page.getFrameTree",
  "Page.navigate",
  "Page.printToPDF",
  "Page.setDocumentContent",
  "Page.setLifecycleEventsEnabled",
  "Performance.enable",
  "Runtime.addBinding",
  "Runtime.callFunctionOn",
  "Runtime.enable",
  "Runtime.evaluate",
  "Runtime.getProperties",
  "Runtime.releaseObject",
  "Runtime.runIfWaitingForDebugger",
  "Target.attachToTarget",
  "Target.closeTarget",
  "Target.createTarget",
  "Target.detachFromTarget",
  "Target.getBrowserContexts",
  "Target.getTargets",
  "Target.setAutoAttach",
  "Target.setDiscoverTargets",
];

const PARAMS = {
  "Page.navigate": { url: "about:blank" },
  "Target.createTarget": { url: "about:blank" },
};

const guard = (limits = {}, options = {}) =>
  new Guard({ ...LIMITS, pagesPerSession: 2, outputBytes: 10, ...limits }, { toBrowser: () => undefined, ...options });
const command = (g, method, params = {}, extra = {}) => g.command(JSON.stringify({ id: 1, method, params, ...extra }));
const refusal = (verdict) => JSON.parse(verdict.reply).error.message;

function protocolMethods() {
  const methods = [];
  for (const protocol of [require("devtools-protocol/json/browser_protocol.json"), require("devtools-protocol/json/js_protocol.json")]) {
    for (const domain of protocol.domains) for (const command of domain.commands ?? []) methods.push(`${domain.domain}.${command.name}`);
  }
  return methods;
}

describe("the allowlist", () => {
  test("is exactly the methods Puppeteer sends for setContent, pdf, screenshot, evaluate, waitForSelector, viewport, fonts and input", () => {
    assert.deepEqual(allowedMethods(), [...EXPECTED].sort());
  });

  test("refuses every other method of the DevTools protocol", () => {
    const methods = protocolMethods();
    assert.ok(methods.length > 500, `the protocol lists ${methods.length} methods`);
    const passed = [];
    for (const method of methods) {
      const verdict = command(guard(), method, PARAMS[method] ?? {});
      if (verdict.forward && !EXPECTED.includes(method)) passed.push(method);
      if (EXPECTED.includes(method) && !method.startsWith("IO.") && method !== "Browser.close") assert.ok(verdict.forward, method);
    }
    assert.deepEqual(passed, []);
  });

  test("refuses drag and drop, which can carry a file into the page", () => {
    const files = { type: "drop", x: 1, y: 1, data: { items: [], files: ["/etc/passwd"], dragOperationsMask: 1 } };
    assert.match(refusal(command(guard(), "Input.dispatchDragEvent", files)), /Drag and drop is off/);
    assert.match(refusal(command(guard(), "Input.setInterceptDrags", { enabled: true })), /Drag and drop is off/);
  });

  test("refuses each named method and domain with a reason", () => {
    for (const [method, params, pattern] of [
      ["Target.createTarget", { url: "https://example.com/" }, /opens only about:blank/],
      ["Target.createTarget", { url: "data:text/html,x" }, /opens only about:blank/],
      ["Target.attachToBrowserTarget", {}, /not on the renderer's allowlist/],
      ["Target.exposeDevToolsProtocol", { targetId: "T" }, /not on the renderer's allowlist/],
      ["Target.createBrowserContext", { proxyServer: "http://elsewhere:3128" }, /not on the renderer's allowlist/],
      ["Page.navigate", { url: "https://example.com/" }, /page\.goto\("https:\/\/example\.com\/"\) is refused/],
      ["Page.navigate", { url: "http://10.0.0.1/" }, /is refused/],
      ["Page.navigate", { url: "file:///etc/passwd" }, /is refused/],
      ["Page.navigate", { url: "http://assets.local/mermaid.min.js" }, /is refused/],
      ["Page.setDownloadBehavior", { behavior: "allow" }, /Downloads are off/],
      ["Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" }, /Downloads are off/],
      ["Browser.grantPermissions", { permissions: ["geolocation"] }, /allowlist/],
      ["Fetch.enable", { patterns: [{ urlPattern: "*" }] }, /Request interception is fixed/],
      ["Fetch.fulfillRequest", { requestId: "1", responseCode: 200 }, /Request interception is fixed/],
      ["Fetch.continueRequest", { requestId: "1", url: "https://example.com/" }, /Request interception is fixed/],
      ["IO.read", { handle: "blob:1" }, /Only the stream of a PDF/],
      ["IO.resolveBlob", { objectId: "1" }, /Only the stream of a PDF/],
      ["Storage.getCookies", {}, /allowlist/],
      ["SystemInfo.getInfo", {}, /allowlist/],
      ["Tracing.start", {}, /allowlist/],
      ["Network.loadNetworkResource", { url: "https://example.com/" }, /allowlist/],
      ["DOM.setFileInputFiles", { files: ["/etc/passwd"] }, /File uploads are off/],
      ["CSS.enable", {}, /allowlist/],
      ["Page.startScreencast", {}, /allowlist/],
    ]) {
      assert.match(refusal(command(guard(), method, params)), pattern, `${method} ${JSON.stringify(params)}`);
    }
  });
});

describe("file: URLs", () => {
  test("are found in parsed params, at any depth, however the raw text spelled them", () => {
    for (const raw of [
      '{"id":1,"method":"Runtime.evaluate","params":{"expression":"fetch(\'file:///etc/passwd\')"}}',
      '{"id":1,"method":"Runtime.evaluate","params":{"expression":"fetch(\'file:\\/\\/\\/etc\\/passwd\')"}}',
      '{"id":1,"method":"Runtime.evaluate","params":{"expression":"fetch(\'\\u0066ile:///etc/passwd\')"}}',
      '{"id":1,"method":"Runtime.evaluate","params":{"expression":"fetch(\'FILE:etc/passwd\')"}}',
      '{"id":1,"method":"Runtime.evaluate","params":{"expression":"fetch(\'file:\\\\\\\\etc\\\\passwd\')"}}',
      '{"id":1,"method":"Runtime.callFunctionOn","params":{"functionDeclaration":"(a) => a","arguments":[{"value":{"deep":["<img src=\'file:///etc/hosts\'>"]}}]}}',
    ]) {
      assert.match(refusal(guard().command(raw)), /may name a file: URL/, raw);
    }
  });

  test("a word that ends in file is not a scheme", () => {
    assert.equal(namesFileUrl({ text: "profile: Wohnhaus, Datei: Grundriss, file name" }), false);
    assert.equal(namesFileUrl({ text: "a file: here" }), true);
  });

  test("the forwarded command is the parsed one, not the raw text", () => {
    const raw = '{"id":1,"method":"Page.navigate","params":{"url":"https://example.com/","url":"about:blank"}}';
    const verdict = guard().command(raw);
    assert.equal(verdict.forward, JSON.stringify({ id: 1, method: "Page.navigate", params: { url: "about:blank" } }));
  });
});

describe("a session", () => {
  test("reads only the stream of a PDF this session printed", () => {
    const g = guard({ outputBytes: 1024 });
    g.command(JSON.stringify({ id: 5, method: "Page.printToPDF", params: { transferMode: "ReturnAsStream" }, sessionId: "S" }));
    let forwarded = null;
    g.toClient = (text) => {
      forwarded = text;
    };
    g.fromBrowser(JSON.stringify({ id: 5, result: { stream: "pdf-1" }, sessionId: "S" }));
    assert.ok(forwarded);
    assert.ok(command(g, "IO.read", { handle: "pdf-1" }).forward);
    assert.ok(command(g, "IO.close", { handle: "pdf-1" }).forward);
    assert.ok(command(g, "IO.read", { handle: "pdf-1" }).reply, "a closed stream cannot be read again");
    assert.ok(command(g, "IO.read", { handle: "other" }).reply);
  });

  test("Browser.close answers and ends the session", () => {
    const verdict = command(guard(), "Browser.close");
    assert.deepEqual(JSON.parse(verdict.reply), { id: 1, result: {} });
    assert.ok(verdict.close);
    assert.equal(verdict.forward, undefined);
  });

  test("caps the pages of a session", () => {
    const g = guard();
    assert.ok(command(g, "Target.createTarget", { url: "about:blank" }).forward);
    assert.ok(command(g, "Target.createTarget", { url: "about:blank" }).forward);
    assert.match(refusal(command(g, "Target.createTarget", { url: "about:blank" })), /at most 2 pages/);
  });

  test("counts every byte the browser sends to the client and ends the session past the cap", () => {
    const ended = [];
    const g = guard({ outputBytes: 150 }, { onOverflow: (reason) => ended.push(reason) });
    const forwarded = [];
    g.toClient = (text) => forwarded.push(text);
    const event = JSON.stringify({ method: "Runtime.consoleAPICalled", params: { args: [{ value: "x".repeat(40) }] } });
    g.fromBrowser(event);
    assert.equal(forwarded.length, 1);
    assert.deepEqual(ended, []);
    g.fromBrowser(event);
    assert.equal(forwarded.length, 1, "the message past the cap is not forwarded");
    assert.match(ended[0], /more than 150 bytes/);
    assert.ok(g.clientBytes > 150);
  });

  test("closes on a message that is not a command, or that reaches for the guard's own ids", () => {
    assert.ok(guard().command("not json").close);
    assert.ok(guard().command(JSON.stringify({ method: "Page.enable" })).close);
    assert.ok(guard().command(JSON.stringify({ id: 1_000_000_001, method: "Page.enable" })).close);
  });

  test("never forwards the guard's own replies to the client", () => {
    const g = guard();
    const toClient = [];
    g.toClient = (text) => toClient.push(text);
    g.fromBrowser(JSON.stringify({ id: 1_000_000_000, result: {} }));
    assert.deepEqual(toClient, []);
  });
});

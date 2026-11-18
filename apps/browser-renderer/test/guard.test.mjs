import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Guard } from "../src/cdp-guard.mjs";
import { LIMITS } from "../src/limits.mjs";

const sent = [];
const guard = () => new Guard({ ...LIMITS, pagesPerSession: 2, outputBytes: 10 }, { toBrowser: (text) => sent.push(text) });
const command = (g, method, params = {}, extra = {}) => g.command(JSON.stringify({ id: 1, method, params, ...extra }));
const refusal = (verdict) => JSON.parse(verdict.reply).error.message;

describe("the allowlist", () => {
  test("forwards what setContent, pdf, screenshot, evaluate, waitForSelector, viewport and fonts need", () => {
    const g = guard();
    for (const [method, params] of [
      ["Target.getBrowserContexts"],
      ["Target.setDiscoverTargets", { discover: true }],
      ["Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }],
      ["Target.createTarget", { url: "about:blank" }],
      ["Target.attachToTarget", { targetId: "T", flatten: true }],
      ["Browser.getVersion"],
      ["Page.enable"],
      ["Page.getFrameTree"],
      ["Page.setLifecycleEventsEnabled", { enabled: true }],
      ["Page.navigate", { url: "data:text/html,<p>x</p>" }],
      ["Page.printToPDF", { transferMode: "ReturnAsStream" }],
      ["Page.captureScreenshot", { format: "png" }],
      ["Runtime.enable"],
      ["Runtime.evaluate", { expression: "document.title" }],
      ["Runtime.callFunctionOn", { functionDeclaration: "(html) => { document.open(); document.write(html); }" }],
      ["DOM.describeNode", { objectId: "1" }],
      ["CSS.enable"],
      ["Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }],
      ["Emulation.setEmulatedMedia", { media: "print" }],
      ["Network.enable"],
      ["Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 }],
    ]) {
      assert.ok(command(g, method, params).forward, method);
    }
  });

  test("refuses each named method and domain with a reason", () => {
    for (const [method, params, pattern] of [
      ["Target.createTarget", { url: "https://example.com/" }, /opens only about:blank/],
      ["Target.createTarget", { url: "data:text/html,x" }, /opens only about:blank/],
      ["Target.attachToBrowserTarget", {}, /not on the renderer's allowlist/],
      ["Target.exposeDevToolsProtocol", { targetId: "T" }, /not on the renderer's allowlist/],
      ["Page.navigate", { url: "https://example.com/" }, /page\.goto\("https:\/\/example\.com\/"\) is refused/],
      ["Page.navigate", { url: "http://10.0.0.1/" }, /is refused/],
      ["Page.navigate", { url: "file:///etc/passwd" }, /is refused/],
      ["Page.navigate", { url: "http://assets.local/mermaid.min.js" }, /is refused/],
      ["Page.setDownloadBehavior", { behavior: "allow" }, /Downloads are off/],
      ["Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" }, /Downloads are off/],
      ["Browser.grantPermissions", { permissions: ["geolocation"] }, /allowlist/],
      ["Browser.setPermission", {}, /allowlist/],
      ["Browser.crash", {}, /allowlist/],
      ["Fetch.enable", { patterns: [{ urlPattern: "*" }] }, /Request interception is fixed/],
      ["Fetch.fulfillRequest", { requestId: "1", responseCode: 200 }, /Request interception is fixed/],
      ["Fetch.continueRequest", { requestId: "1", url: "https://example.com/" }, /Request interception is fixed/],
      ["Fetch.failRequest", { requestId: "1", errorReason: "Failed" }, /Request interception is fixed/],
      ["IO.read", { handle: "blob:1" }, /Only the stream of a PDF/],
      ["IO.resolveBlob", { objectId: "1" }, /Only the stream of a PDF/],
      ["Storage.getCookies", {}, /allowlist/],
      ["Storage.clearDataForOrigin", { origin: "*", storageTypes: "all" }, /allowlist/],
      ["SystemInfo.getInfo", {}, /allowlist/],
      ["SystemInfo.getProcessInfo", {}, /allowlist/],
      ["Tracing.start", {}, /allowlist/],
      ["Network.loadNetworkResource", { url: "https://example.com/" }, /allowlist/],
      ["Network.setRequestInterception", { patterns: [] }, /allowlist/],
      ["DOM.setFileInputFiles", { files: ["/etc/passwd"] }, /File uploads are off/],
      ["Page.startScreencast", {}, /allowlist/],
      ["Extensions.loadUnpacked", { path: "/tmp" }, /allowlist/],
      ["PWA.install", {}, /allowlist/],
      ["ServiceWorker.enable", {}, /allowlist/],
      ["HeapProfiler.takeHeapSnapshot", {}, /allowlist/],
      ["Runtime.evaluate", { expression: "fetch('file:///etc/passwd')" }, /file:\/\/ URL/],
      ["Runtime.callFunctionOn", { functionDeclaration: "() => 1", arguments: [{ value: "<img src='FILE:///etc/hosts'>" }] }, /file:\/\/ URL/],
      ["Target.createBrowserContext", { proxyServer: "http://elsewhere:3128" }, /own proxy/],
    ]) {
      assert.match(refusal(command(guard(), method, params)), pattern, `${method} ${JSON.stringify(params)}`);
    }
  });

  test("reads only the stream of a PDF this session printed", () => {
    const g = guard();
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

  test("replaces an output past the cap with an error", () => {
    const g = guard();
    let forwarded = null;
    g.toClient = (text) => {
      forwarded = text;
    };
    g.command(JSON.stringify({ id: 7, method: "Page.printToPDF", params: {} }));
    g.fromBrowser(JSON.stringify({ id: 7, result: { data: Buffer.alloc(32).toString("base64") } }));
    assert.match(JSON.parse(forwarded).error.message, /exceeds 10 bytes/);
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

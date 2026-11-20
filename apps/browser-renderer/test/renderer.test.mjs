import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import WebSocket from "ws";
import { startContainer } from "./container.mjs";

let renderer;
before(async () => {
  renderer = await startContainer({ sessions: 2 });
});
after(async () => {
  await renderer?.stop();
});

async function sessionCount() {
  const ended = (await renderer.logs()).filter((line) => line.message === "browser session ended" && line.reason !== "self-test").length;
  return { ended };
}

async function acquire() {
  const response = await fetch(`${renderer.url}/v1/devtools/browser`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}

function sessionSocket(sessionId) {
  const url = new URL(`/v1/devtools/browser/${sessionId}`, `http://${renderer.addr}`);
  url.protocol = "ws:";
  return url.href;
}

async function open() {
  const { body } = await acquire();
  const ws = new WebSocket(sessionSocket(body.sessionId));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let next = 1;
  const waiting = new Map();
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const closed = new Promise((resolve) => ws.once("close", resolve));
  const close = async () => {
    ws.close();
    await closed;
  };
  return { ws, call, close, closed, sessionId: body.sessionId };
}

async function page(browser) {
  const { result } = await browser.call("Target.createTarget", { url: "about:blank" });
  const attached = await browser.call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  await browser.call("Page.enable", {}, attached.result.sessionId);
  return attached.result.sessionId;
}

async function evaluate(browser, sessionId, expression) {
  const answer = await browser.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (answer.error) throw new Error(answer.error.message);
  return answer.result?.result?.value;
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the browser renderer container", () => {
  test("GET /health answers ok", async () => {
    assert.equal((await fetch(`${renderer.url}/health`)).status, 200);
  });

  test("Chromium runs as 10042 with no capabilities under the container's seccomp filter, reached over a pipe", async () => {
    const browser = await open();
    let report;
    try {
      await page(browser);
      report = await renderer.shell(`
        for p in /proc/[0-9]*; do
          case "$(readlink $p/exe 2>/dev/null)" in *chrome-headless-shell) echo "PROC $(grep -E '^(Uid|Gid|Seccomp|NoNewPrivs|CapEff|CapPrm|CapBnd):' $p/status | tr -s '\\t\\n' '  ') $(tr '\\0' ' ' < $p/cmdline)";; esac
        done
        echo ROOT $(awk '$5=="/" {print $6}' /proc/self/mountinfo)
        echo LISTEN; cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4=="0A" {print $2}'`);
    } finally {
      await browser.close();
    }
    const processes = report.split("\n").filter((line) => line.startsWith("PROC"));
    const main = processes.find((line) => line.includes("--user-data-dir=") && line.includes("--remote-debugging-pipe"));
    assert.ok(main, report);
    assert.match(main, /--no-sandbox\b/);
    assert.doesNotMatch(report, /--remote-debugging-port/);
    assert.ok(processes.some((line) => line.includes("--type=renderer")), report);
    for (const line of processes) {
      assert.match(line, /Uid:\s+10042\s+10042\s+10042\s+10042\b/, line);
      assert.match(line, /Gid:\s+10042\s+10042\s+10042\s+10042\b/, line);
      assert.match(line, /NoNewPrivs:\s+1\b/, line);
      assert.match(line, /Seccomp:\s+2\b/, `the container's seccomp filter applies to every Chromium process: ${line}`);
      assert.match(line, /CapEff:\s+0+\s/, line);
      assert.match(line, /CapPrm:\s+0+\s/, line);
      assert.match(line, /CapBnd:\s+0+\s/, line);
    }
    assert.match(report, /^ROOT ro\b/m, report);
    const listening = report.split("LISTEN")[1].trim().split(/\s+/).filter(Boolean);
    const ports = new Set(listening.map((address) => Number.parseInt(address.split(":").pop(), 16)));
    assert.ok(ports.has(9222), report);
    for (const port of ports) assert.ok(port === 9222 || port > 30000, `only the front and its loopback deny-proxy listen, not ${port}`);
  });

  test("a page renders, uses the house fonts and loads Mermaid from the renderer", async () => {
    const browser = await open();
    const sessionId = await page(browser);
    await evaluate(browser, sessionId, `document.body.innerHTML = '<p style="font-family: sans-serif">Grundriss</p>'`);
    assert.equal(await evaluate(browser, sessionId, "document.body.textContent"), "Grundriss");
    assert.equal(await evaluate(browser, sessionId, `document.fonts.check('12px "Source Sans 3"')`), true);
    assert.equal(await evaluate(browser, sessionId, `document.fonts.check('12px "Source Code Pro"')`), true);
    const mermaid = await evaluate(
      browser,
      sessionId,
      `new Promise((resolve) => { const s = document.createElement("script"); s.src = "http://assets.local/mermaid.min.js";
        s.onload = () => resolve(typeof mermaid); s.onerror = () => resolve("failed"); document.head.append(s); })`,
    );
    assert.equal(mermaid, "object");
    await browser.close();
  });

  test("every request from the page except data: and blob: is refused", async () => {
    const browser = await open();
    const sessionId = await page(browser);
    const outcome = await evaluate(
      browser,
      sessionId,
      `(async () => {
        const probe = (url) => fetch(url).then((r) => "loaded " + r.status, () => "refused");
        const image = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve("loaded"); i.onerror = () => resolve("refused"); i.src = src; });
        const worker = await new Promise((resolve) => {
          const w = new Worker(URL.createObjectURL(new Blob(["fetch('https://example.com/w').then(() => postMessage('loaded'), () => postMessage('refused'))"])));
          w.onmessage = (e) => resolve(e.data);
        });
        return {
          https: await probe("https://example.com/"),
          http: await probe("http://example.com/"),
          ip: await probe("http://10.0.0.1/"),
          loopback: await probe("http://127.0.0.1:9222/health"),
          image: await image("https://example.com/logo.png"),
          ws: await new Promise((resolve) => { const s = new WebSocket("wss://example.com/"); s.onopen = () => resolve("loaded"); s.onerror = () => resolve("refused"); }),
          worker,
          data: await probe("data:text/plain,ok"),
          blob: await probe(URL.createObjectURL(new Blob(["ok"]))),
        };
      })()`,
    );
    assert.deepEqual(outcome, {
      https: "refused",
      http: "refused",
      ip: "refused",
      loopback: "refused",
      image: "refused",
      ws: "refused",
      worker: "refused",
      data: "loaded 200",
      blob: "loaded 200",
    });
    await browser.close();
  });

  test("file:// is refused in every form", async () => {
    const browser = await open();
    const sessionId = await page(browser);
    const navigate = await browser.call("Page.navigate", { url: "file:///etc/passwd" }, sessionId);
    assert.match(navigate.error.message, /is refused/);
    const named = await browser.call("Runtime.evaluate", { expression: "fetch('file:///etc/passwd')" }, sessionId);
    assert.match(named.error.message, /may name a file: URL/);
    const built = await evaluate(
      browser,
      sessionId,
      `fetch(["fi", "le:", "//", "/etc/passwd"].join("")).then((r) => r.text(), () => "refused")`,
    );
    assert.equal(built, "refused");
    const framed = await evaluate(
      browser,
      sessionId,
      `new Promise((resolve) => { const f = document.createElement("iframe"); f.src = ["fi", "le:///etc/hostname"].join("");
        f.onload = () => { try { resolve(f.contentDocument ? f.contentDocument.body.textContent : "opaque"); } catch { resolve("opaque"); } };
        document.body.append(f); setTimeout(() => resolve("refused"), 1500); })`,
    );
    assert.ok(framed === "opaque" || framed === "refused" || framed === "", `the frame shows nothing of the file: ${framed}`);
    await browser.close();
  });

  test("downloads go nowhere, and a page cannot open a window", async () => {
    const browser = await open();
    const sessionId = await page(browser);
    await evaluate(
      browser,
      sessionId,
      `(() => { const a = document.createElement("a"); a.href = "data:text/plain,secret"; a.download = "leak.txt"; document.body.append(a); a.click(); window.open("about:blank"); })()`,
    );
    await settle(800);
    const targets = await browser.call("Target.getTargets");
    const pages = targets.result.targetInfos.filter((info) => info.type === "page");
    assert.equal(pages.length, 2, "the first tab and the page this test opened, no window from window.open");
    const found = await renderer.shell("find /tmp /home/pptruser -name 'leak.txt*' 2>/dev/null | head -5; true");
    assert.equal(found, "");
    const asked = await browser.call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" });
    assert.match(asked.error.message, /Downloads are off/);
    await browser.close();
  });

  test("drag and drop cannot carry a file of the renderer into the page", async () => {
    const browser = await open();
    const sessionId = await page(browser);
    const drop = await browser.call(
      "Input.dispatchDragEvent",
      { type: "drop", x: 10, y: 10, data: { items: [], files: ["/etc/passwd"], dragOperationsMask: 1 } },
      sessionId,
    );
    assert.match(drop.error.message, /Drag and drop is off/);
    const intercept = await browser.call("Input.setInterceptDrags", { enabled: true }, sessionId);
    assert.match(intercept.error.message, /Drag and drop is off/);
    await browser.close();
  });

  test("Chromium's orphaned processes are reaped: no zombies after several sessions", async () => {
    for (let i = 0; i < 4; i += 1) {
      const browser = await open();
      await page(browser);
      await browser.close();
    }
    await settle(1000);
    const zombies = await renderer.shell("grep -l '^State:[[:space:]]*Z' /proc/[0-9]*/status 2>/dev/null | wc -l");
    assert.equal(Number(zombies), 0);
    const init = await renderer.shell("tr '\\0' ' ' < /proc/1/cmdline");
    assert.match(init, /tini/);
  });

  test("a closed session leaves no browser process and no profile behind", async () => {
    const before = await sessionCount();
    const browser = await open();
    await page(browser);
    await browser.close();
    for (let i = 0; i < 100 && (await sessionCount()).ended <= before.ended; i += 1) await settle(50);
    await settle(200);
    const left = await renderer.shell(
      `ls /tmp/browser-renderer | grep profile- ; for p in /proc/[0-9]*; do readlink $p/exe 2>/dev/null | grep chrome-headless-shell; done; true`,
    );
    assert.equal(left, "");
  });

  test("answers 503 busy when both sessions are taken, and a second socket to one session is refused", async () => {
    const one = await open();
    const two = await open();
    const third = await acquire();
    assert.equal(third.status, 503);
    assert.deepEqual(third.body, { error: "busy" });
    const again = new WebSocket(sessionSocket(one.sessionId));
    const refused = await new Promise((resolve) => {
      again.once("open", () => resolve(false));
      again.once("error", () => resolve(true));
    });
    assert.ok(refused);
    await Promise.all([one.close(), two.close()]);
  });

  test("a session that never connects is closed", async () => {
    let status = 503;
    for (let i = 0; i < 40 && status === 503; i += 1) {
      ({ status } = await acquire());
      if (status === 503) await settle(50);
    }
    assert.equal(status, 200);
    for (let i = 0; i < 60; i += 1) {
      if ((await renderer.logs()).some((line) => line.reason === "no connection")) return;
      await settle(250);
    }
    assert.fail("the unconnected session was not closed");
  });
});

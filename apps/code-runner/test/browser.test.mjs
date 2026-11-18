import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startBrowserRenderer } from "./browser-harness.mjs";
import { returned, startRunner } from "./harness.mjs";

let renderer;
let runner;
before(async () => {
  renderer = await startBrowserRenderer({ sessions: 2 });
  runner = await startRunner({ slots: 4, browserAddr: renderer.addr });
});
after(async () => {
  await runner?.stop();
  await renderer?.stop();
});

const timings = {};

async function timed(name, body) {
  const started = Date.now();
  const answer = await runner.run(body);
  timings[name] = Date.now() - started;
  return answer;
}

const MERMAID = `
import puppeteer from "@cloudflare/puppeteer";
import { mkdir, writeFile } from "node:fs/promises";

export default async function () {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent("<body></body>");
    await page.addScriptTag({ url: "http://assets.local/mermaid.min.js" });
    const svg = await page.evaluate(async (source) => {
      mermaid.initialize({ startOnLoad: false, fontFamily: "Source Sans 3" });
      return (await mermaid.render("diagram", source)).svg;
    }, "flowchart LR\\n  Entwurf --> Einreichung --> Bewilligung");
    await page.setContent(\`<body style="margin:0">\${svg}</body>\`);
    const png = await (await page.$("svg")).screenshot({ omitBackground: true });
    await mkdir("/workspace/out", { recursive: true });
    await writeFile("/workspace/out/ablauf.svg", svg);
    await writeFile("/workspace/out/ablauf.png", png);
    return svg.length;
  } finally {
    await browser.close();
  }
}`;

describe("the browser", () => {
  test("HTML and CSS become a PDF", async () => {
    const { http, body } = await timed("htmlToPdf", {
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        import { writeFile } from "node:fs/promises";
        export default async function (input) {
          const browser = await puppeteer.launch(env.BROWSER);
          const page = await browser.newPage();
          await page.setContent(\`<style>body { font-family: "Source Sans 3"; } h1 { color: #1d3557; }</style>
            <h1>\${input.title}</h1><p>Wohnnutzfläche 132,40 m²</p>\`);
          const pdf = await page.pdf({ format: "A4", printBackground: true });
          await writeFile("/workspace/bericht.pdf", pdf);
          await browser.close();
          return pdf.length;
        }`,
      input: { title: "Baubeschreibung" },
    });
    assert.equal(http, 200);
    assert.equal(body.status, "ok", body.stderr);
    const pdf = returned(body, "/workspace/bericht.pdf");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("latin1"), /SourceSans3/);
  });

  test("a Mermaid diagram becomes SVG and PNG", async () => {
    const { body } = await timed("mermaid", { source: MERMAID });
    assert.equal(body.status, "ok", body.stderr);
    assert.match(returned(body, "/workspace/out/ablauf.svg").toString(), /<svg[\s\S]*Einreichung/);
    assert.deepEqual([...returned(body, "/workspace/out/ablauf.png").subarray(1, 4)], [0x50, 0x4e, 0x47]);
  });

  test("a screenshot of HTML is a PNG of the asked size", async () => {
    const { body } = await timed("screenshot", {
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        import { writeFile } from "node:fs/promises";
        export default async function () {
          const browser = await puppeteer.launch(env.BROWSER);
          const page = await browser.newPage();
          await page.setViewport({ width: 640, height: 360 });
          await page.setContent('<div style="width:640px;height:360px;background:linear-gradient(#fff,#1d3557)"></div>');
          await writeFile("/workspace/shot.png", await page.screenshot());
          await browser.close();
          return null;
        }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    const png = returned(body, "/workspace/shot.png");
    assert.equal(png.readUInt32BE(16), 640);
    assert.equal(png.readUInt32BE(20), 360);
  });

  test("a request from the page to the network is refused", async () => {
    const { body } = await runner.run({
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        export default async function () {
          const browser = await puppeteer.launch(env.BROWSER);
          const page = await browser.newPage();
          await page.setContent("<p>x</p>");
          const result = await page.evaluate(async () => Promise.all([
            fetch("https://example.com/").then((r) => "loaded " + r.status, () => "refused"),
            fetch("http://10.0.0.1/").then((r) => "loaded " + r.status, () => "refused"),
            new Promise((resolve) => { const img = new Image(); img.onload = () => resolve("loaded"); img.onerror = () => resolve("refused"); img.src = "https://example.com/logo.png"; }),
          ]));
          await browser.close();
          return result;
        }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.deepEqual(body.value, ["refused", "refused", "refused"]);
  });

  test("page.goto to an http(s) URL is refused, a data: URL is not", async () => {
    const { body } = await runner.run({
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        export default async function () {
          const browser = await puppeteer.launch(env.BROWSER);
          const page = await browser.newPage();
          const refused = await page.goto("https://example.com/").then(() => "loaded", (error) => error.message);
          await page.goto("data:text/html,<title>ok</title>");
          const title = await page.title();
          await browser.close();
          return { refused, title };
        }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    assert.match(body.value.refused, /is refused/);
    assert.equal(body.value.title, "ok");
  });

  test("DevTools calls off the renderer's allowlist are refused inside a run", async () => {
    const { body } = await runner.run({
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        export default async function () {
          const browser = await puppeteer.launch(env.BROWSER);
          const page = await browser.newPage();
          const client = await page.createCDPSession();
          const tried = {};
          for (const [method, params] of [
            ["Storage.getCookies", {}],
            ["SystemInfo.getInfo", {}],
            ["Tracing.start", {}],
            ["Fetch.enable", { patterns: [{ urlPattern: "*" }] }],
            ["Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" }],
            ["Network.loadNetworkResource", { frameId: page.mainFrame()._id, url: "https://example.com/", options: { disableCache: true, includeCredentials: false } }],
          ]) {
            tried[method] = await client.send(method, params).then(() => "allowed", (error) => (/is refused/.test(error.message) ? "refused" : error.message));
          }
          tried.interception = await page.setRequestInterception(true).then(() => "allowed", (error) => (/is refused/.test(error.message) ? "refused" : error.message));
          await browser.close();
          return tried;
        }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    for (const [method, outcome] of Object.entries(body.value)) assert.equal(outcome, "refused", method);
  });

  test("a run that leaves its browser open still ends, and its browser is closed", async () => {
    const { body } = await runner.run({
      source: `
        import puppeteer from "@cloudflare/puppeteer";
        export default async function () {
          const browser = await puppeteer.launch(env.BROWSER);
          await browser.newPage();
          return "left open";
        }`,
    });
    assert.equal(body.status, "ok", body.stderr);
    const ended = async () => (await renderer.logs()).filter((line) => line.message === "browser session ended" && line.reason !== "self-test").length;
    const launched = 7;
    for (let i = 0; i < 100 && (await ended()) < launched; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await ended(), launched, "every browser of every run has ended");
  });

  test("every browser in use answers 503 busy for the whole run", async () => {
    const hold = `
      import puppeteer from "@cloudflare/puppeteer";
      export default async function () {
        const browser = await puppeteer.launch(env.BROWSER);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await browser.close();
        return "held";
      }`;
    const holding = [runner.run({ source: hold }), runner.run({ source: hold })];
    await new Promise((resolve) => setTimeout(resolve, 600));
    const third = await runner.run({ source: hold });
    assert.equal(third.http, 503);
    assert.deepEqual(third.body, { error: "busy" });
    for (const { body } of await Promise.all(holding)) assert.equal(body.value, "held", body.stderr);
  });

  test("timings", () => {
    console.log(JSON.stringify({ browserTimingsMs: timings }));
  });
});

describe("a runner without a browser", () => {
  test("says so when a run launches one", async () => {
    const bare = await startRunner({ slots: 1 });
    try {
      const { body } = await bare.run({
        source: `import puppeteer from "@cloudflare/puppeteer";
          export default async () => { await puppeteer.launch(env.BROWSER); }`,
      });
      assert.equal(body.status, "error");
      assert.match(body.stderr, /no browser/);
    } finally {
      await bare.stop();
    }
  });
});

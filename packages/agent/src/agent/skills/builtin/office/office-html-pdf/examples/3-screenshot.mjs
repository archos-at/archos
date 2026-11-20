import puppeteer from "@cloudflare/puppeteer";
import { readFile, writeFile } from "node:fs/promises";

export default async function () {
  const diagram = encodeURIComponent(await readFile("/workspace/Ablauf.svg", "utf8"));
  const html = `<body style="margin:0; font-family: 'Source Sans 3'; background:#f5f7fa">
    <div id="card" style="width:900px; padding:32px; background:#fff">
      <h2 style="margin:0 0 16px; font-weight:600">Projektstand KW 47</h2>
      <img src="data:image/svg+xml,${diagram}" style="width:100%">
    </div></body>`;
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 964, height: 600, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    const png = await (await page.$("#card")).screenshot({ type: "png" });
    await writeFile("/workspace/Projektstand.png", png);
    return { file: "/workspace/Projektstand.png", bytes: png.length };
  } finally {
    await browser.close();
  }
}

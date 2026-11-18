---
name: office-html-pdf
description: >
  Use when a PDF has to look designed (a report with a cover, colours, a
  layout), when the person wants a diagram (Mermaid: a process, a schedule, an
  organisation), or a PNG picture of HTML or a chart. HTML and CSS rendered by
  Puppeteer in a headless Chromium. Read `office-files` first for the run
  contract.
metadata:
  agents: researcher
  title: HTML zu PDF, Diagramme, Screenshots
---

# HTML to PDF, Mermaid, screenshots

Read `office-files` first if you have not this conversation.

## Which tool

| The person wants | Take |
|---|---|
| A designed PDF: a report, an exposé, a cover, colour, a free layout | HTML and CSS here |
| A diagram in Mermaid, or one for Word or a slide as SVG or PNG | Mermaid here |
| A PNG of HTML, a chart or a diagram | `page.screenshot()` here |
| A PDF that reads like a document: long text, tables across pages, a Gantt or flowchart inside it | Typst (`office-pdf`) |
| A form filled in, PDFs merged or split, an existing PDF edited | `pdf-lib` (`office-pdf-charts`) |

If `puppeteer.launch` fails with "no browser", this deployment has none and a
retry gets the same answer. Keep the format the person asked for: a PDF with
Typst (`office-pdf`) in the same look; a diagram as SVG drawn in code, or with
Typst's `fletcher` or `timeliney`; a Word file with that SVG in it. A PNG of
HTML cannot be made without the browser: offer the SVG or PDF instead and say
so in one sentence, without naming the engine. On "busy", run once more first.

## The browser

- `import puppeteer from "@cloudflare/puppeteer"` and
  `const browser = await puppeteer.launch(env.BROWSER)`: ordinary Puppeteer.
  Close it in `finally`. A run may launch 2 browsers and open 10 pages.
- The page has no network. `page.goto` to an address is refused, and so is
  every request the page makes, except `data:` and `blob:` URLs. Put the HTML
  in with `page.setContent(html)`; read a file from `/workspace/` and pass its
  text, or embed it as a `data:` URL (an image, an SVG).
- Fonts: "Source Sans 3" (also `sans-serif`) and "Source Code Pro" (also
  `monospace`) are installed. No other web font loads.
- Mermaid: `await page.addScriptTag({ url: "http://assets.local/mermaid.min.js" })`
  is the one script the page may load. Render with `htmlLabels: false`, so the
  SVG shows its labels in Word, in an `<img>` and in other viewers.
- `page.pdf()` and `page.screenshot()` return bytes; write them with
  `writeFile`. A run's PDFs and screenshots together stay under 50 MB.
- No downloads, no file uploads, no request interception, no new windows.

## A report as PDF

`@page` sets the paper and margins; `preferCSSPageSize: true` makes `page.pdf`
take them. Keep a table row on one page with `break-inside: avoid`. Page
numbers go in `footerTemplate`, which uses its own fonts and sizes: set them.

```js
import puppeteer from "@cloudflare/puppeteer";
import { writeFile } from "node:fs/promises";

const rooms = [
  { room: "Wohnen/Essen", storey: "EG", area: 38.4 },
  { room: "Küche", storey: "EG", area: 11.2 },
  { room: "Zimmer 1", storey: "OG", area: 14.6 },
  { room: "Bad", storey: "OG", area: 7.9 },
];

const area = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default async function () {
  const total = rooms.reduce((sum, r) => sum + r.area * 100, 0) / 100;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm 18mm 20mm; }
    body { font-family: "Source Sans 3", sans-serif; font-size: 10.5pt; color: #1f2933; }
    h1 { font-size: 22pt; font-weight: 600; margin: 0 0 2mm; }
    .meta { color: #616e7c; margin-bottom: 8mm; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 600; border-bottom: 1.2pt solid #1f2933; padding: 2mm 0; }
    td { border-bottom: 0.5pt solid #cbd2d9; padding: 1.8mm 0; }
    td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
    tr { break-inside: avoid; }
    tfoot td { font-weight: 600; border-bottom: none; border-top: 1.2pt solid #1f2933; }
  </style></head><body>
    <h1>Flächenaufstellung</h1>
    <div class="meta">Wohnhaus Musterweg 4 · Stand ${new Intl.DateTimeFormat("de-DE").format(new Date())}</div>
    <table>
      <thead><tr><th>Raum</th><th>Geschoss</th><th class="n">Fläche m²</th></tr></thead>
      <tbody>${rooms.map((r) => `<tr><td>${escape(r.room)}</td><td>${r.storey}</td><td class="n">${area.format(r.area)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Summe</td><td></td><td class="n">${area.format(total)}</td></tr></tfoot>
    </table>
  </body></html>`;

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font: 8pt 'Source Sans 3'; width: 100%; padding: 0 18mm; text-align: right; color: #616e7c">
        Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>`,
    });
    await writeFile("/workspace/Flächenaufstellung.pdf", pdf);
    return { file: "/workspace/Flächenaufstellung.pdf", total, bytes: pdf.length };
  } finally {
    await browser.close();
  }
}
```

## A Mermaid diagram as SVG, PNG and in Word

Render the diagram, then screenshot the SVG element for a PNG. Word takes the
PNG (`ImageRun`, `type: "png"`), keep the aspect ratio from `boundingBox()`.

```js
import puppeteer from "@cloudflare/puppeteer";
import docx from "docx";
import { writeFile } from "node:fs/promises";

const diagram = `flowchart LR
  E[Entwurf] --> B[Baueingabe]
  B --> P{Prüfung}
  P -- Mängel --> E
  P -- ok --> G[Bewilligung]`;

export default async function () {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
    await page.setContent('<body style="margin:0"></body>');
    await page.addScriptTag({ url: "http://assets.local/mermaid.min.js" });
    const svg = await page.evaluate(async (source) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        themeVariables: { fontFamily: '"Source Sans 3", sans-serif' },
      });
      return (await mermaid.render("ablauf", source)).svg;
    }, diagram);
    await page.setContent(`<body style="margin:0; background:#fff">${svg}</body>`);
    const element = await page.$("svg");
    const box = await element.boundingBox();
    const png = await element.screenshot({ type: "png" });
    await writeFile("/workspace/Ablauf.svg", svg);
    await writeFile("/workspace/Ablauf.png", png);

    const width = 450;
    const height = Math.round((width * box.height) / box.width);
    const doc = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({ text: "Ablauf der Einreichung", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({ children: [new docx.ImageRun({ type: "png", data: png, transformation: { width, height } })] }),
        ],
      }],
    });
    await writeFile("/workspace/Ablauf.docx", new Uint8Array(await docx.Packer.toArrayBuffer(doc)));
    return { files: ["/workspace/Ablauf.svg", "/workspace/Ablauf.png", "/workspace/Ablauf.docx"], size: { width: box.width, height: box.height } };
  } finally {
    await browser.close();
  }
}
```

## A screenshot of HTML

`deviceScaleFactor: 2` gives a sharp PNG. Screenshot an element, not the page,
to get its size exactly.

```js
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
```

## Check it

Read the PDF's text back with `unpdf` (`office-pdf-charts`) and compare every
heading and figure with the data the run had. Look at a PNG only through its
size and the run's `value`: nothing here shows it to you.

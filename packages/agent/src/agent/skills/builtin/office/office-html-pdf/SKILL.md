---
name: office-html-pdf
description: >
  A PDF with a designed layout, a Mermaid diagram or a PNG? Code that works in
  this sandbox.
metadata:
  agents: researcher
  title: HTML zu PDF, Diagramme, Screenshots
---

# HTML to PDF, Mermaid, screenshots

Read `execute` first if you have not this conversation.

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
- Fonts: "General Sans" (the house face, 400 to 600 with italics), "Source
  Sans 3" (also `sans-serif`) and "Source Code Pro" (also
  `monospace`) are installed. No other web font loads.
- Mermaid: `await page.addScriptTag({ url: "http://assets.local/mermaid.min.js" })`
  is the one script the page may load. Render with `htmlLabels: false`, so the
  SVG shows its labels in Word, in an `<img>` and in other viewers.
- `page.pdf()` and `page.screenshot()` return bytes; write them with
  `writeFile`. A run's PDFs and screenshots together stay under 50 MB.
- No downloads, no file uploads, no request interception, no new windows.

## A report as PDF

`htmlPage({ title, body })` from `house-style` wraps your body in the house
CSS (`office-design`): A4 with margins through `@page`, type, tables (`class="n"`
right-aligns a number cell), and the blocks `meta`, `lead`, `figures`, `band`,
`finding` and `cover`. `pdfOptions(footer)` gives `page.pdf` the footer with
page numbers. Add your own `<style>` in the body for anything else, in the same
colours (`colors`).

```js
import puppeteer from "@cloudflare/puppeteer";
import { writeFile } from "node:fs/promises";
import { format, htmlPage, pdfOptions } from "house-style";

const rooms = [
  { room: "Wohnen/Essen", storey: "EG", area: 38.4 },
  { room: "Küche", storey: "EG", area: 11.2 },
  { room: "Zimmer 1", storey: "OG", area: 14.6 },
  { room: "Bad", storey: "OG", area: 7.9 },
];

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default async function () {
  const total = rooms.reduce((sum, r) => sum + r.area * 100, 0) / 100;
  const html = htmlPage({
    title: "Flächenaufstellung",
    body: `
    <h1>Flächenaufstellung</h1>
    <div class="meta">Wohnhaus Musterweg 4 · Stand ${format.date(new Date())}</div>
    <div class="figures">
      <div><b>${format.area(total)}</b><span>Nutzfläche gesamt</span></div>
      <div><b>${rooms.length}</b><span>Räume</span></div>
    </div>
    <table>
      <thead><tr><th>Raum</th><th>Geschoss</th><th class="n">Fläche m²</th></tr></thead>
      <tbody>${rooms.map((r) => `<tr><td>${escape(r.room)}</td><td>${r.storey}</td><td class="n">${format.number(r.area)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Summe</td><td></td><td class="n">${format.number(total)}</td></tr></tfoot>
    </table>
    <div class="finding"><strong>Prüfen</strong> Die Fläche des Bads liegt unter dem Raumprogramm (8,50 m²).</div>`,
  });

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf(pdfOptions("Wohnhaus Musterweg 4 · Flächenaufstellung"));
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
        themeVariables: { fontFamily: '"General Sans", sans-serif' },
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
  const html = `<body style="margin:0; font-family: 'General Sans'; background:#ffffff">
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

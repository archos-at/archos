---
name: office-pdf-charts
description: >
  Use when the person wants a PDF made, filled, merged or split, the text of a
  PDF read, or a chart: a Planliste as PDF, an authority's form filled in, a
  bar or line chart of costs or areas as SVG. Read `office-files` first for the
  run contract.
metadata:
  agents: researcher
  title: PDF und Diagramm erstellen
---

# A PDF, a chart

Read `office-files` first if you have not this conversation.

## A PDF with `pdf-lib`

- Lengths are points: A4 is `[595.28, 841.89]`, 1 cm = 28.35. `y` counts from
  the bottom of the page.
- The standard fonts (`StandardFonts.Helvetica`, `HelveticaBold`) know only
  WinAnsi characters. Umlauts, ß, €, ², ³, °, Ø, „ “ and – work; ≤ ≥ − ≈ Δ ⌀
  and the narrow space throw "WinAnsi cannot encode". Map them first, as
  `safe` does below. No other font can be embedded here.
- `drawText` does not wrap: break lines yourself with `widthOfTextAtSize`, and
  start a new page when `y` reaches the bottom margin.
- Draw page numbers after all pages exist, so "von N" is right.
- Save with `await pdf.save()`. `PDFDocument.load(bytes)` opens an existing PDF;
  `copyPages` merges and splits.
- A PDF of a Word or Excel file the run made is not made here: offer the .docx
  or .xlsx.

```js
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const A4 = [595.28, 841.89];
const MARGIN = 56.7;

const WIN_ANSI = { "≤": "<=", "≥": ">=", "−": "-", "≈": "~", "Δ": "Delta ", "⌀": "Ø", "∅": "Ø", "\u202f": " " };
const safe = (text) => [...String(text)].map((ch) => WIN_ANSI[ch] ?? ch).join("");

function wrap(text, font, size, width) {
  const lines = [];
  let current = "";
  for (const word of safe(text).split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  return current ? [...lines, current] : lines;
}

export default async function () {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Planliste");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const line = (text, { font = regular, size = 10, x = MARGIN, right = false } = {}) => {
    const shown = safe(text);
    const at = right ? x - font.widthOfTextAtSize(shown, size) : x;
    page.drawText(shown, { x: at, y, size, font, color: rgb(0, 0, 0) });
  };

  line("Planliste", { font: bold, size: 16 });
  y -= 28;
  const rows = [["A-101", "Grundriss EG", "C", "12.11.2026"], ["A-102", "Grundriss OG", "B", "03.11.2026"]];
  for (const [index, row] of [["Nummer", "Inhalt", "Index", "Datum"], ...rows].entries()) {
    if (y < MARGIN + 40) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
    const font = index === 0 ? bold : regular;
    line(row[0], { font });
    line(row[1], { font, x: MARGIN + 70 });
    line(row[2], { font, x: MARGIN + 300 });
    line(row[3], { font, x: A4[0] - MARGIN, right: true });
    y -= 16;
  }
  y -= 8;
  const note = "Brüstungshöhe ≥ 1,00 m bei allen Fenstern im OG; die Fläche der Wohnung beträgt 58,45 m². Abweichungen sind mit der Bauherrschaft abzustimmen und im nächsten Stand einzuarbeiten.";
  for (const text of wrap(note, regular, 9, A4[0] - 2 * MARGIN)) {
    line(text, { size: 9 });
    y -= 12;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Seite ${i + 1} von ${pages.length}`;
    p.drawText(label, { x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 8), y: 28, size: 8, font: regular });
  });

  await writeFile("/workspace/Planliste.pdf", await pdf.save());
  return { file: "/workspace/Planliste.pdf", pages: pages.length };
}
```

## Reading a PDF with `unpdf`

To check a PDF you made, or to read one the person sent (named in `documents`,
at `/workspace/in/`):

```js
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export default async function () {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile("/workspace/Planliste.pdf")));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text.map((page, i) => ({ page: i + 1, chars: page.length, start: page.slice(0, 400) })) };
}
```

A scanned PDF has no text layer and comes back empty: say so.

## A form

An authority's form with fillable fields is filled with `pdf-lib`'s form API.
List the fields first and match each to what the person told you; a field you
cannot fill from what you know stays empty and is named in the answer. Values
go through the same WinAnsi limit. A form without fields cannot be filled
reliably here: say so.

```js
import { readFile, writeFile } from "node:fs/promises";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";

export default async function () {
  const pdf = await PDFDocument.load(await readFile("/workspace/in/Formular.pdf"));
  const form = pdf.getForm();
  const fields = form.getFields().map((field) => ({
    name: field.getName(),
    type: field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox" : field.constructor.name,
  }));
  const values = { bauvorhaben: "Wohnhaus Musterstraße 12", datum: "18.11.2026" };
  for (const [name, value] of Object.entries(values)) form.getTextField(name).setText(value);
  form.getCheckBox("baufuehrer").check();
  await writeFile("/workspace/Formular-ausgefuellt.pdf", await pdf.save());
  return { fields, filled: Object.keys(values).length + 1 };
}
```

## A chart with Vega-Lite

Write a Vega-Lite spec, compile it, and render it to SVG without a browser. The
sandbox forbids `eval`, so the view needs `vega-interpreter`: always
`vega.parse(spec, null, { ast: true })` and
`new vega.View(runtime, { expr: expressionInterpreter, renderer: "none" })`.

- German number format on the axes through `config.locale` as below, and
  `axis: { format: ",.0f" }`.
- Bars start at zero; one colour unless a second one means something; the
  axis title names the unit.
- The SVG is a file of its own. In a deck use a native chart instead
  (`office-powerpoint`); a Word file cannot take it from a run.

```js
import { writeFile } from "node:fs/promises";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";

export default async function () {
  const values = [
    { stage: "Kostenschätzung", eur: 412000 },
    { stage: "Kostenberechnung", eur: 451000 },
    { stage: "Kostenanschlag", eur: 448500 },
  ];
  const spec = vegaLite.compile({
    width: 420,
    height: 240,
    config: { font: "Arial", locale: { number: { decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] } } },
    data: { values },
    mark: { type: "bar", color: "#4C6A92" },
    encoding: {
      x: { field: "stage", type: "nominal", sort: null, title: null, axis: { labelAngle: 0 } },
      y: { field: "eur", type: "quantitative", title: "EUR netto", axis: { format: ",.0f" } },
    },
  }).spec;
  const view = new vega.View(vega.parse(spec, null, { ast: true }), { expr: expressionInterpreter, renderer: "none" });
  const svg = await view.toSVG();
  await view.finalize();
  await writeFile("/workspace/Kostenentwicklung.svg", svg);
  return { file: "/workspace/Kostenentwicklung.svg", bytes: svg.length, values };
}
```

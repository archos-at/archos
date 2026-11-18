---
name: office-powerpoint
description: >
  Use when the person wants a PowerPoint deck (.pptx): a Bauherrenbesprechung, a
  project status, options compared with a table or a chart; or wants the text of
  a deck read. Read `office-files` first for the run contract.
metadata:
  agents: researcher
  title: Präsentation erstellen
---

# A PowerPoint deck

`pptxgenjs` builds new decks. Read `office-files` first if you have not this
conversation.

## The deck

- One message per slide, and the deck built toward what the meeting is for: a
  decision, the open points, the next dates. About two minutes of talk per slide.
- Titles at the same place and size on every content slide, without a full
  stop. Body text left-aligned, never below 14 pt; titles 28 to 36 pt.
- Arial or Calibri: the person's PowerPoint renders the font you name.
- At most five bullets on a slide; if the text does not fit its box, cut words
  or split the slide rather than shrink the type.

## The library

- Set `pptx.layout = "LAYOUT_16x9"` before adding slides: the slide is
  10 × 5.625 inches, every `x`, `y`, `w`, `h` is in inches, and a shape past the
  edge is written off the slide, not clamped. Keep 0.5 inch to every edge.
- Colours are six hex digits without `#` (`"4C6A92"`); a `#` or an alpha digit
  corrupts the file.
- Build a fresh options object for every `add…` call: the library changes the
  objects you pass.
- Bullets are an array of `{ text, options: { bullet: true } }` in one
  `addText`; never type a `•`.
- `addTable` takes rows of strings or `{ text, options }`; `colW` sets the
  column widths. Write numbers already formatted (412.000).
- Keep charts native: `addChart(pptx.ChartType.bar, [{ name, labels, values }], options)`
  makes a chart the office can edit. Set `valAxisMinVal: 0`, `chartColors`,
  `showLegend: false` for one series, and `showValue: true` with a
  `dataLabelFormatCode`. On a stacked chart `dataLabelPosition: "outEnd"`
  corrupts the file; take `"inEnd"` or `"ctr"`.
- One `new PptxGenJS()` per file. Speaker notes go in `slide.addNotes("…")`.
- Save with `await pptx.write({ outputType: "uint8array" })`.

```js
import { writeFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";

export default async function () {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = "Bauherrenbesprechung";

  const title = pptx.addSlide();
  title.addText("Bauherrenbesprechung 4", { x: 0.6, y: 1.8, w: 8.8, h: 1, fontSize: 32, bold: true, fontFace: "Arial" });
  title.addText("Wohnhaus Musterstraße 12 · 18.11.2026", { x: 0.6, y: 2.9, w: 8.8, h: 0.5, fontSize: 16, color: "555555", fontFace: "Arial" });

  const status = pptx.addSlide();
  status.addText("Offene Punkte", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, fontFace: "Arial" });
  status.addText(
    [
      { text: "Fensterfarbe festlegen", options: { bullet: true } },
      { text: "Angebot Haustechnik prüfen", options: { bullet: true } },
      { text: "Termin Einreichung bestätigen", options: { bullet: true } },
    ],
    { x: 0.5, y: 1.1, w: 4.4, h: 2.5, fontSize: 16, fontFace: "Arial", valign: "top" },
  );
  status.addTable(
    [
      [{ text: "Kostengruppe", options: { bold: true, fill: { color: "D9D9D9" } } },
        { text: "EUR", options: { bold: true, fill: { color: "D9D9D9" }, align: "right" } }],
      ["Baukonstruktion", { text: "412.000", options: { align: "right" } }],
      ["Technik", { text: "138.500", options: { align: "right" } }],
    ],
    { x: 5.2, y: 1.1, w: 4.3, colW: [2.6, 1.7], fontSize: 14, fontFace: "Arial", border: { type: "solid", pt: 0.5, color: "999999" } },
  );
  status.addChart(
    pptx.ChartType.bar,
    [{ name: "Kosten", labels: ["KS", "KF", "KB"], values: [412000, 451000, 448500] }],
    {
      x: 0.5, y: 3.7, w: 9, h: 1.8, barDir: "col", valAxisMinVal: 0, valAxisLabelFormatCode: "#,##0",
      chartColors: ["4C6A92"], showLegend: false, showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0",
      catAxisLabelFontFace: "Arial", valAxisLabelFontFace: "Arial", dataLabelFontFace: "Arial",
    },
  );

  await writeFile("/workspace/Bauherrenbesprechung.pptx", await pptx.write({ outputType: "uint8array" }));
  return { file: "/workspace/Bauherrenbesprechung.pptx", slides: 2 };
}
```

## Check it

Read each slide's XML back with `jszip` (`ppt/slides/slide1.xml`, …), strip the
tags as `office-word` shows for a .docx, and check every title, bullet and
figure is there and in order.

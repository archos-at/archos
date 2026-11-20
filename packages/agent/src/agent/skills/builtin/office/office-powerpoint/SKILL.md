---
name: office-powerpoint
description: >
  Making a PowerPoint deck? The mistakes that break a .pptx, and code that
  works.
metadata:
  agents: researcher
  title: Präsentation erstellen
---

# A PowerPoint deck

`pptxgenjs` builds new decks. Read `execute` first if you have not this
conversation, and `office-design` for the look: `houseDeck` from
`house-style` sets the layout, the masters, titles, footer and slide numbers,
and returns fresh options for every `add…` call.

## The deck

- One message per slide, and the deck built toward what the meeting is for: a
  decision, the open points, the next dates. About two minutes of talk per slide.
- The title says what the slide shows, as a sentence without a full stop.
  `deck.slide(title)` puts it in the same place on every slide. Body text
  left-aligned, never below 14 pt.
- Aptos (`fonts.office`), Microsoft 365's own face: the person's PowerPoint
  renders the font you name, and an older Office substitutes it. When the
  person says their Office has no Aptos, take Arial.
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
import { houseDeck } from "house-style";

export default async function () {
  const pptx = new PptxGenJS();
  pptx.title = "Bauherrenbesprechung 4";
  const deck = houseDeck(pptx, { footer: "Wohnhaus Musterstraße 12 · Bauherrenbesprechung 4" });

  deck.cover({
    title: "Bauherrenbesprechung 4",
    subtitle: "Kosten, offene Entscheidungen, nächste Termine",
    meta: "Wohnhaus Musterstraße 12 · 18.11.2026",
  });

  const decisions = deck.slide("Drei Entscheidungen brauchen wir heute");
  decisions.addText(
    deck.bullets(["Fensterfarbe: Anthrazit oder Eiche", "Angebot Haustechnik annehmen", "Einreichung am 05.12.2026 bestätigen"]),
    deck.text("left"),
  );
  decisions.addTable(
    deck.table(
      [["Kostengruppe", "EUR"], ["Baukonstruktion", "412.000"], ["Technik", "138.500"], ["Summe", "550.500"]],
      { numeric: [1], total: true },
    ),
    deck.tableOptions("right", { colW: [2.6, 1.6] }),
  );

  deck.section("Kosten");

  const costs = deck.slide("Die Kostenschätzung liegt 9 % über dem Budget");
  costs.addChart(
    pptx.ChartType.bar,
    [{ name: "Kosten", labels: ["Budget", "Kostenschätzung", "Kostenberechnung"], values: [412000, 451000, 448500] }],
    deck.chart("wide", { barDir: "col", valAxisLabelFormatCode: "#,##0", showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0" }),
  );
  costs.addText("Mehrkosten vor allem aus der Haustechnik (+ 31.000 EUR) und der Fassade (+ 8.000 EUR).", deck.text("aside", { fontSize: 14 }));
  costs.addNotes("Haustechnik: Wärmepumpe statt Gastherme, vom Bauherrn gewünscht.");

  await writeFile("/workspace/Bauherrenbesprechung.pptx", await pptx.write({ outputType: "uint8array" }));
  return { file: "/workspace/Bauherrenbesprechung.pptx", slides: 4 };
}
```

## Check it

Read each slide's XML back with `jszip` (`ppt/slides/slide1.xml`, …), strip the
tags as `office-word` shows for a .docx, and check every title, bullet and
figure is there and in order.

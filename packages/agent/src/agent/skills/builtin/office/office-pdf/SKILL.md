---
name: office-pdf
description: >
  Making a PDF document, a schedule or a flowchart? Code that typesets it
  right the first time.
metadata:
  agents: researcher
  title: PDF setzen
---

# A PDF set with Typst

`import { compile } from "typst"` turns Typst markup into PDF bytes inside the
run: `await compile(markup, { files })` returns a `Uint8Array`, which you write
to `/workspace/<Name>.pdf`. `files` maps a name the markup uses (`"chart.svg"`,
`"logo.png"`) to a string or bytes.

## Which tool

| The person wants | Use |
|---|---|
| A document: report, Baubeschreibung, Terminplan, protocol, anything with diagrams | Typst, below |
| A one-page table or list built from data, or Typst failed twice | Forme, at the end |
| A form filled, PDFs merged or split, text read | `pdf-lib` and `unpdf`, see `office-pdf-charts` |

Typst needs no browser: draw diagrams with the Typst packages below, charts
with Vega-Lite as SVG handed in through `files`. Mermaid and free HTML layouts
are `office-html-pdf`, which needs the browser; without it, draw the diagram here
with `fletcher` (flowcharts) or `timeliney` (Gantt).

## Rules

- Start every document with `typstPreamble` from `house-style`, as the
  example does: A4, margins, header and footer, type, headings, tables, and the
  `house` colours and helpers (`office-design`). Header and footer text go in
  through `typstInputs({ header, footer, lang })`; merge your own inputs into
  the same object. The fonts are General Sans (the house face: Regular, Medium,
  Semibold, each with italic), Source Sans 3 and, for code, Source Code Pro;
  no other font exists.
- Page numbers only in the footer, as `counter(page).display()` and
  `counter(page).final().first()` inside `context`.
- Tables: `table.header(...)` repeats on every page. Right-align numbers and
  write them German (`32,40`), computed in JavaScript.
- `#pagebreak()` before a part that must start on a new page;
  `#block(breakable: false)[…]` keeps a diagram with its heading.
- Only these packages exist, at exactly these versions:
  `@preview/fletcher:0.5.8` (flowcharts), `@preview/timeliney:0.4.0` (Gantt),
  `@preview/chronos:0.3.0` (sequence), `@preview/cetz:0.4.2` (drawing). Any
  other import fails.
- Text from the person or a document goes in as data, not markup:
  `compile(markup, { inputs: { ...typstInputs({ … }), notiz: text } })` and
  `#sys.inputs.notiz` in the markup. Pasted into the markup, a `#`, `*`, `_`, `$`, `<` or `@` in it changes
  the document.
- A compile error comes back on stderr with `main.typ:line:column`: fix that
  line and run again.

## Example

```js
import { writeFile } from "node:fs/promises";
import { compile } from "typst";
import { format, typstInputs, typstPreamble } from "house-style";

const rooms = [["EG", "Wohnen", 32.4], ["EG", "Küche", 11.2], ["OG", "Zimmer 1", 14.8]];

export default async function () {
  const rows = rooms.map(([floor, room, area]) => `[${floor}], [${room}], [${format.number(area)}],`).join("\n");
  const total = format.number(rooms.reduce((sum, [, , area]) => sum + area, 0));
  const markup = typstPreamble + String.raw`
#import "@preview/fletcher:0.5.8": diagram, node, edge
#import "@preview/timeliney:0.4.0"
#set heading(numbering: "1.")

#house-title([Baubeschreibung], subtitle: [Wohnhaus Lindengasse], meta: [Stand 18.11.2026])

= Flächen
#table(columns: (auto, 1fr, auto), align: (left, left, right),
  table.header[Geschoss][Raum][Fläche m²],
  ${rows}
  table.hline(stroke: 0.75pt + house.ink), [], [*Summe*], [*${total}*])

= Ablauf
#diagram(node-stroke: 0.6pt + house.ink, spacing: 14mm,
  node((0,0), [Entwurf]), edge("-|>"),
  node((1,0), [Einreichung]), edge("-|>"),
  node((2,0), [Bewilligung], fill: house.band))

= Terminplan
#timeliney.timeline(show-grid: true, {
  import timeliney: *
  headerline(group(([2027], 6)))
  headerline(group(..range(6).map(n => "M" + str(n + 1))))
  taskgroup(title: [Planung], {
    task("Vorentwurf", (0, 2), style: (stroke: 6pt + house.ink))
    task("Einreichplanung", (1.5, 4), style: (stroke: 6pt + house.muted))
  })
  milestone(at: 4, style: (stroke: (paint: house.markup, dash: "dashed")), align(center, text(fill: house.markup)[Einreichung]))
})
`;
  const pdf = await compile(markup, { inputs: typstInputs({ header: "Wohnhaus Lindengasse · Baubeschreibung", footer: "Stand 18.11.2026" }) });
  await writeFile("/workspace/Baubeschreibung.pdf", pdf);
  return { file: "/workspace/Baubeschreibung.pdf", bytes: pdf.byteLength };
}
```

An SVG chart is drawn as outlines: its labels look right but cannot be searched
or copied, so state the key figures in the text or a table as well.
A chart: make the SVG as in `office-pdf-charts` (`await view.toSVG()`), pass it
as `compile(markup, { files: { "kosten.svg": svg } })` and place it with
`#image("kosten.svg", width: 80%)`. A sequence diagram:
`#import "@preview/chronos:0.3.0"` and
`#chronos.diagram({ import chronos: *; _par("A", display-name: "Architekt"); _par("B", display-name: "Behörde"); _seq("A", "B", comment: "Einreichung") })`.

A Typst run takes a few seconds; check the result with `unpdf` (page count, the
text of page 1) before you name the file in the answer.

## The simple path: Forme

Components built with `h(Component, props, ...children)`; no JSX. `Fixed`
repeats on every page, and `{{pageNumber}}` and `{{totalPages}}` are filled in.
An SVG (a Vega-Lite chart) goes in as `h(Svg, { width, height, content: svg })`.

```js
import { writeFile } from "node:fs/promises";
import { Document, Page, Text, Table, Row, Cell, Fixed, h, renderDocument } from "forme";

const cell = (text, style) => h(Cell, { style: { padding: 4, ...style } }, h(Text, null, text));

export default async function () {
  const rows = [["A-101", "Grundriss EG", "C"], ["A-102", "Grundriss OG", "B"]];
  const doc = h(Document, null,
    h(Page, { size: "A4", margin: 48 },
      h(Fixed, { position: "header" }, h(Text, { style: { fontSize: 8, color: "#555" } }, "Büro – Wohnhaus Lindengasse")),
      h(Fixed, { position: "footer" }, h(Text, { style: { fontSize: 8, textAlign: "right" } }, "Seite {{pageNumber}} von {{totalPages}}")),
      h(Text, { style: { fontSize: 18, fontWeight: "bold", marginBottom: 8 } }, "Planliste"),
      h(Table, { columns: [{ width: { fraction: 0.2 } }, { width: { fraction: 0.65 } }, { width: { fraction: 0.15 } }] },
        h(Row, { header: true, style: { backgroundColor: "#e6e6e6" } }, cell("Nummer"), cell("Inhalt"), cell("Index")),
        ...rows.map((row) => h(Row, null, ...row.map((value) => cell(value)))))));
  await writeFile("/workspace/Planliste.pdf", await renderDocument(doc));
}
```

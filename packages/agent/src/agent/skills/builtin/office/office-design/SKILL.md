---
name: office-design
description: >
  Making a deck, a PDF, a Word or Excel file the person will show to others?
  The house style: what makes it look like a good office made it, and the
  module that does most of it for you.
metadata:
  agents: researcher
  title: Gestaltung
---

# The house style

Architects judge a document by its look before they read it. A file that looks
like a template from 2005 (blue title bars, clip art, a colour per bar, centred
text, bold everywhere) is redone by hand, whatever its content. Make it look like
the office's own drawings: white paper, black ink, one grey, exact alignment,
generous white space.

`import { … } from "house-style"` gives you all of that ready made. Use it for
every file unless the person gives a template or asks for another look: their
Briefpapier, their Vorlage, their colours always win (`execute`, „The office's
template"). The module is a default, not a cage: take what fits and set
anything else yourself in the same spirit.

## The rules

- **Ink, paper, one grey.** Text in `colors.text`, headings and figures in
  `colors.ink`, secondary text in `colors.muted`, a band or highlighted area in
  `colors.band`. No other colour for decoration: no coloured title bars, no
  coloured table heads, no gradients, no shadows, no rounded boxes.
- **Red means "look here".** `colors.markup` only marks a finding, a defect, a
  deviation or a missed deadline, always with a word beside it. Never for a
  heading or an accent.
- **Hierarchy by size and space,** not by colour, boxes or bold. One title per
  page or slide, then size steps down. Bold only for a table's head and total.
- **Lines only where they work:** a rule under a table head, a hairline between
  rows, a rule over a total. No frames around text, no lines under titles, no
  vertical lines in tables.
- **Left-aligned,** text and titles. Numbers right-aligned with tabular figures,
  formatted German (`format.number`, `format.area`, `format.date`).
- **A slide says one thing,** and its title is that thing as a sentence („Die
  Kostenschätzung liegt 9 % über dem Budget", not „Kosten"). At most five
  bullets; cut words before you shrink type.
- **A chart has one series in ink** unless it compares; at most three series
  (`series`: ink, dark grey, grey), a fourth goes to „Sonstige" or a second
  chart. Start bars at zero, label values directly, no 3D, no pie with more
  than three parts.
- **No pictures you invented:** no icons, emoji, stock images or AI images. A
  plan, a photo or a logo goes in only when the person or a document supplied it.
- **No product name in the document.** The file is the office's; the marking
  that the agent wrote it goes into the file's metadata for you.

## The module

| Import | What it is | Where |
|---|---|---|
| `colors`, `series`, `hex(color)` | The brand's print colours (`#rrggbb`); `hex` strips the `#` for pptxgenjs and docx | everywhere |
| `fonts` | `office` (Aptos, Microsoft 365's face; Arial for an older Office), `pdf` (General Sans, embedded in every PDF), `mono` | everywhere |
| `format.number(n, digits)`, `format.area(n)`, `format.date(d)` | 1.234,56 · 32,40 m² · 18.11.2026 | everywhere |
| `houseDeck(pptx, { footer })` | 16:9 master with title placeholder, footer and slide number. Returns `cover({ title, subtitle, meta })`, `section(title)`, `slide(title)` and fresh options for each `add…`: `text(box)`, `bullets(items)`, `table(rows, { numeric, total })` with `tableOptions(box)`, `chart(box, { series, … })`. Boxes: `full`, `left`, `right`, `wide`, `aside` | `office-powerpoint` |
| `htmlPage({ title, lang, body })`, `css`, `pdfOptions(footer)` | A4 page, type scale, tables, and the classes `meta`, `lead`, `n` (number cell), `figures`, `band`, `finding`, `cover` | `office-html-pdf` |
| `typstPreamble`, `typstInputs({ header, footer, lang })` | Page, type, headings, tables, and `house` colours, `#house-title`, `#house-band`, `#house-finding`, `#house-figures` | `office-pdf` |
| `docxStyles`, `docxPage`, `docxTableBorders()`, `docxHeaderCell()` | `new Document({ styles: docxStyles })`, `properties: { page: docxPage }`, a table's borders and its head cells | `office-word` |
| `styleSheet(worksheet, { header, numeric, numFmt, total })` | Head row, number columns, total row, frozen head | `office-excel` |
| `vegaLiteConfig` | `config` of a Vega-Lite spec: type, ink series, quiet axes | `office-pdf-charts` |

Each file type's skill shows it in its example. A deck in a few lines:
`const deck = houseDeck(pptx, { footer: "Projekt · Anlass" })`, then
`deck.slide("Aussage als Satz").addText(deck.bullets([…]), deck.text("left"))`.

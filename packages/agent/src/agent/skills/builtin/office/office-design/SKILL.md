---
name: office-design
description: Design guidance for any file a person will look at, from a deck to a spreadsheet.
metadata:
  agents: researcher
  title: Gestaltung
---

# Design

Aim for documents that look edited, not decorated: calm, precise, confident.
Everything here is a default. Start from it, and depart when the content, the
person or the office's own template asks for something else; their letterhead,
colours and type always lead. The document is the office's: their name and
project on it, never the product's.

## Principles

- **Restraint.** Contrast and space do the work. Colour appears where it
  carries meaning, always with a word beside it.
- **Hierarchy through scale.** One dominant element per page or slide, a few
  clear size steps below it. Bold for a table's head and its total.
- **Whitespace is structure.** Group by proximity, separate by space, keep
  margins generous. Tables stay open: a rule under the head, hairlines between
  rows, a rule over the total.
- **A grid.** Few shared edges, the same element in the same place on every
  page. Text left, numbers right in tabular figures.
- **One idea per unit.** A slide makes one point and its title states it as a
  sentence: „Die Kostenschätzung liegt 9 % über dem Budget“ rather than „Kosten“.
- **Data at a glance.** The figure that matters set large, values labelled
  directly, bars from zero, charts flat. Up to three series in shades of ink;
  the rest goes to „Sonstige“ or a second chart.
- **Real material.** The office's plans, photos and figures, and diagrams you
  draw from data. Where nothing real exists, leave the space empty: icons,
  emoji, stock and generated images stay out.

## The house look

The default look is the brand's that `house-style` carries. Use it for anything
you design freely too, such as a cover or an HTML layout.

- **Colour:** white paper, near-black ink, one light grey for a band (at most
  two per page, never adjacent), hairlines in a lighter grey, secondary text in
  a mid grey. Red is the reviewer's pen: it marks a finding. Take the values
  from `colors`.
- **Type:** one sans face. Large headings set close (line height about 1.2),
  body at a comfortable measure of about 70 characters.
- **Shape:** square corners, flat surfaces, left-aligned on a twelve-column
  grid like a plan layout.
- **Diagrams:** thin lines on a grid, one solid element for the point.

## Defaults in code

`import { … } from "house-style"` carries the look; each file type's skill
shows it in its example.

| Import | Sets up |
|---|---|
| `colors`, `series`, `hex(color)` | Palette and chart series as `#rrggbb`; `hex` strips the `#` for pptxgenjs and docx |
| `fonts`, `format` | Faces (Aptos in Office, Hanken Grotesk in PDFs); German numbers, areas and dates |
| `houseDeck(pptx, { footer })` | Slide master; returns `cover`, `section`, `slide` and fresh `text`, `bullets`, `table`, `tableOptions`, `chart` options |
| `htmlPage`, `css`, `pdfOptions` | A4 page, type scale and blocks for HTML to PDF |
| `typstPreamble`, `typstInputs` | Page, type, tables and the `#house-…` helpers for Typst (`office-pdf`) |
| `docxStyles`, `docxPage`, `docxTableBorders()`, `docxHeaderCell()` | Word styles, page and tables |
| `styleSheet(sheet, { header, numeric, numFmt, total })` | Excel head row, number columns, total row |
| `vegaLiteConfig` | Chart type, colour and axes |

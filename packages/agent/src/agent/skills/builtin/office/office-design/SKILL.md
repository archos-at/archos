---
name: office-design
description: Design guidance for decks, PDFs, Word and Excel files.
metadata:
  agents: researcher
  title: Gestaltung
---

# Design

Aim for documents that look edited, not decorated: calm, precise, confident.
Everything here is a default. Start from it, and depart when the content, the
person or the office's own template asks for something else; their letterhead,
colours and type always lead.

## Principles

- **Restraint.** Contrast and space do the work. Colour appears where it
  carries meaning.
- **Hierarchy through scale.** One dominant element per page or slide, a few
  clear size steps below it.
- **Whitespace is structure.** Group by proximity, separate by space, keep
  margins generous.
- **A grid.** Few shared edges, the same element in the same place on every
  page. Text left, numbers right in tabular figures.
- **One idea per unit.** A slide makes one point and its title states it:
  „Die Kostenschätzung liegt 9 % über dem Budget“ rather than „Kosten“.
- **Data at a glance.** The figure that matters set large, values labelled
  directly, bars from zero.
- **Real material.** The office's plans, photos and figures; empty space where
  there is nothing real to show.

## The house look

The default look is our brand's. Use it for anything you design freely too: a
cover, an HTML layout, a one-pager.

- **Colour:** warm white paper, near-black ink, one light grey for a band (at
  most two per page, never adjacent), hairlines in a lighter grey, secondary
  text in a mid grey. Red is the reviewer's pen: it marks a finding.
- **Type:** one sans face in medium weight. Large headings with tight leading
  and open tracking; a statement heading ends with a full stop („Kosten im
  Rahmen.“). Body at a comfortable measure, about 70 characters.
- **Shape:** square corners, flat surfaces, lines only where they separate
  (a table head, a total). Left-aligned on a twelve-column grid, like a plan
  layout.
- **Images:** line drawings on a grid with one solid element as the point;
  real working material shot from above.

## Defaults in code

`import { … } from "house-style"` carries the look; each file type's skill
shows it in its example.

| Import | Sets up |
|---|---|
| `colors`, `series`, `fonts`, `format` | Palette, chart series, faces (Aptos in Office, Hanken Grotesk in PDFs), German numbers and dates |
| `houseDeck(pptx, { footer })` | Slide master, cover, section and content slides, text, table and chart options |
| `htmlPage`, `css`, `pdfOptions` | A4 page, type scale and blocks for HTML to PDF |
| `typstPreamble`, `typstInputs` | Page, type and tables for Typst |
| `docxStyles`, `docxPage` | Word styles and page |
| `styleSheet(worksheet)` | Excel head, number columns, total row |
| `vegaLiteConfig` | Chart type, colour and axes |

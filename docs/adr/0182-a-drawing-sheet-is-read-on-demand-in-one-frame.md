---
status: proposed
date: 2026-11-11
decision-makers: Matthias Bigl
consulted:
informed:
---

# A drawing sheet is read on demand, by one reader, into one frame

## Context and Problem Statement

The agent could not state a number from a drawing PDF. `look` shows a rendered
crop and a vision model reads it, which misreads small figures; no page
geometry was stored anywhere; the scale existed only as a string a model read
off the title block. Measuring existed for IFC models and for a DXF cadastral
extract, and for nothing an office uploads as a drawing.

A vector plot holds what is needed: every figure as characters, every wall as a
stroked path, and sometimes the scale of each view as a stored region
(`/VP` with `/Measure`). The question is where that is read, when, and in which
coordinate frame, so that a figure, a line and a person's click mean the same
place. The build order and every later piece are in
[`drawing-measurement-build-spec.md`](../roadmap/drawing-measurement-build-spec.md).

## Decision Drivers

* A wrong number stated confidently is the failure this feature exists to end.
  A frame error (a crop origin, a rotation) is exactly such a number.
* The heaviest sheet found holds 1,234,452 segments on one A1; reading it took
  10.3 s with pypdfium2 and 38 s with pdfplumber (measured 2026-11-11).
* The agent package may not import `knowledge_layer` (contract
  `agent-knowledge-port`, ADR-0072).

## Considered Options

* Read geometry at ingestion and store it.
* Read it on demand with pdfplumber, which the ingest already uses.
* Read it on demand with PDFium (pypdfium2) for geometry and characters, and
  pdfminer for the page dictionary entries PDFium does not give.

## Decision Outcome

Chosen option: "on demand, PDFium plus pdfminer", because it is the fastest
reader measured, both libraries are already installed, and nothing has to be
stored or migrated before the first slice is useful.

* **One reader, in `knowledge_layer.sheet`.** `reader.py` is the only module
  that touches PDFium or pdfminer for a sheet. It returns plain values (tuples,
  dicts, `array` columns), so the agent package converts them without importing
  a type.
* **One frame: the page as shown, in points, origin top left, y down.** It is
  the frame of `look`'s `region` and of the review annotations once divided by
  the page's size. The page's own user space is left behind in the reader and
  nowhere else: object matrix, then the effective box's origin, then the
  rotation.
* **`look` reads characters only.** A look at a PDF page returns the figures
  whose centre lies inside its crop, as printed, each with its place, and the
  sheet's size. No path is walked for a look.
* **Printed text is quoted text.** The lines reach the model inside the passage
  fence (`common/passage_fence.py`); a licensed page's lines only inside its
  licensed hit (ADR-0164); never on the look card.
* **A figure is whole or absent.** One whose centre lies outside the crop is
  left out, never cut. A raised final digit stays in its figure.
* **A page is bounded.** More than 2,000,000 segments is refused with the
  count.

### Consequences

* Good, because a figure the model quotes from a vector sheet is the file's own
  characters, not a reading of pixels.
* Good, because every later piece (scale, probe, calibration, the person's
  tape) shares one frame, verified against PDFium's own `FPDF_PageToDevice` on
  all four rotations and on a cropped page.
* Bad, because every look at a PDF page now opens the file twice (the render,
  then the text layer) and returns up to 60 more lines (2,400 characters).
* Bad, because the reader reports what the file holds, not what is visible: an
  object cut by a clip path or on a hidden layer still comes back, a shape
  filled and not stroked comes back as flagged edges, and text plotted as
  linework has no characters. The callers state these limits.
* Bad, because a scan gets nothing from this: a page of one image has no text
  layer and no linework, and says so.

### Confirmation

`packages/knowledge-layer/tests/test_sheet_reader.py` holds the frame against
PDFium on four rotations and a cropped page, the Bézier chord, the object and
form matrices, and that `read_characters` walks no path.
`test_sheet_figures.py` holds reading order („185“, not „581“), the raised
digit and the four rotations; `test_sheet_crop_text.py` the whole-or-absent
rule and the bound. `packages/agent/tests/tools/look/test_printed_text.py`
holds the fence, the licensed path and the card. The import contract
`agent-knowledge-port` holds the package boundary.

## Pros and Cons of the Options

### Geometry at ingestion

* Good, because a second question about a sheet costs no read.
* Bad, because it needs a store, a migration and a re-ingest of every drawing
  before anything works, and a million segments per sheet is the wrong thing to
  keep for sheets nobody asks about. Premise: sheets are measured rarely against
  how often they are uploaded. Revisit if sheet facts are wanted in search.

### pdfplumber

* Good, because the ingest already depends on it.
* Bad, because it took 3.4 s where PDFium took 0.4 s (64,606 segments) and 38 s
  where PDFium took 10.3 s, and it reports a cropped page in the MediaBox's
  frame. Premise: pdfplumber 0.11 builds a dict per path.

## More Information

Revisit when a pilot office's sheets are mostly scans (nothing here reads
them), or when the per-look text read shows up in turn latency. The facts about
the two libraries that cost time to find are in the build specification under
„Facts about the readers“.

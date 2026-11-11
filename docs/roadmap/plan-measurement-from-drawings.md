# Measuring a building from its drawings

*Rewritten 2026-11-11 from the note of 2026-08-19, after a research pass over the
code, the offices' feedback, the market and real plan files. Companion to
[oib-geometry-coverage.md](./oib-geometry-coverage.md), which covers the case where
an IFC model exists. This one is about the case where it does not, which is every
pilot office today. Backlog: tickets 33 „Maßstab kalibrieren: Pläne maßhaltig
machen“ and 34 „Im Plan und im IFC-Modell messen“.*

**This is a plan. Nothing in it is built.** What exists today is listed under
[Where we are](#where-we-are).

## The star

An architect opens a plot PDF of a floor plan and asks „Ist dieser Gang breit
genug?“. The agent answers with a number, its unit, how exact it is and where it
comes from, marks the spot on the sheet, and names the clause it compared against.
Where the sheet cannot decide the question, it says so and says what would. The same
person can lay a tape on the sheet themselves, leave the measurement there for a
colleague, and trust that every number on that sheet, theirs or the agent's, rests
on a scale somebody checked.

## The rule this plan inherits

`oib-geometry-coverage.md` states it for the model path and it applies unchanged:
**the engine measures, the Bestimmung judges.**

One clause is added, forced by measuring from a sheet:

> **A number without its tolerance is a different number wearing an exact one's
> clothes.** Every measurement carries an interval and a provenance, and the judge
> must be able to answer *nicht entscheidbar*.

And one ordering, which the research confirmed at every turn:

> **Read before you measure.** A figure the draughtsman printed beats any number
> derived from linework. The engine measures only what nobody wrote down.

**The number never passes through a language model.** A vision model finds the sheet,
the room and the place to measure. The figure comes from the file's text or its
geometry.

## Where we are

Checked in the code on 2026-11-11.

| Thing | State |
|---|---|
| Scale of a PDF sheet | A string the vision model reads off the title block at ingestion (`visual_analysis.py`, schema v5, `drawing_scale`). Never parsed, never tied to the page. |
| Page geometry | Not stored. `page.get_size()` is read to triage and to render, then dropped. No vector linework, no text positions. |
| What the agent sees | `look`: a JPEG with a 2048 px long edge, or a region crop up to 1200 dpi; six looks a turn. The result names pixels, never millimetres or a scale. |
| What the agent is told | „A value read off a drawing or a photo is a reading, not a measurement“ (`chat_static.md`). Correct, and the reason no number comes out. |
| Review view | Annotations are a point or a box in shares of the page (`document_annotations`). No measuring, no calibration. |
| IFC | `ifc_measure` and `ifc_query` measure with tolerance and provenance. The viewer measures point to point. No plausibility check on the length unit. |
| DXF | Drawn to a to-scale PDF (ADR-0152) and measured by `dxf_measure` (ADR-0153). The tool is a site tool: parcels, neighbours, setbacks, buildable area. For any other DXF it lists labels and per-layer totals. Model space only. |
| DWG | Not accepted. |
| Evals | The visual set asks for printed figures only. Nothing measures an undimensioned span. |

So measuring exists for a model and for a cadastral extract, and for nothing an
office actually uploads as a plan.

## What the research found

### What offices need

Counted across the meeting notes of the three pilot offices (October and November 2026):

| Job | Conversations | Typical cost today |
|---|---|---|
| Areas and room lists: area schedules, the room programme, funding lists, the Topo check | 6 | half a day to three days per pass |
| Clear widths, escape routes, minimum dimensions | 3 | leaves the product for CAD |
| Counts that disagree between a list and the plans | 3 | found by chance |
| A ratio per elevation (facade greening) | 1 | redone at every change |

The top job is reconciling printed room-stamp areas with lists. It needs exact
reading far more than geometry. No office has delivered an IFC model. One office
said that a wrong assessment harms more than none, and that a pointer to the exact
spot already helps.

### What plan files carry

Fourteen files were probed with pdfplumber, which the backend already ships: twelve
from the dev workspace and two public ones. This is a small, skewed sample (seven
are student or presentation sheets). The pilot offices' own plots are still the
missing corpus.

| Finding | Count |
|---|---|
| Vector linework, not a scan | 14 of 14 |
| Text kept as text | 14 of 14 |
| Dimension figures present as text | 7 of 14; the others are presentation sheets with none |
| Scale stored in the file itself (PDF viewports, ISO 32000 §12.9) | 1 of 14, the AutoCAD plot |
| PDF layers | 3 of 14: both Archicad files and the AutoCAD plot |
| Non-standard sheet size | 3 of 14 |

Details that shape the design:

- **One sheet holds several scales.** The AutoCAD plot, a public sample submission
  plan on A0, stores eight regions: five at 1:100, one at 1:200, one at 1:500 and
  the sheet at 1:1. Its unit label is blank, so the ratio is only right if the
  drawing unit is metres; the printed scale notes confirm that. **A scale belongs
  to a region of a page, not to a page.** Ticket 33 says per page.
- **Archicad stores no scale** and exports layers by default. One of its layers is
  named „910 Allgemein Bemaßung“, which finds the dimension figures without
  guessing. All three pilot offices work in Archicad.
- **Figures follow three conventions.** Metres with a comma („6,50“), millimetres
  as integers („2250“), and what looks like centimetres with a millimetre digit
  („61.8“). In one Archicad file rotated figures came out of the text layer
  reversed („581“ for 185).
- **Big sheets are slow.** One A1 site plan holds 515,000 segments and took 38 s to
  read. Geometry is read once at ingestion, never per question.
- **A sheet is unreadable as one image.** A whole A0 at the largest size the
  current flagship models accept lands near 49 dpi, where 2.5 mm dimension text is
  about 5 px high (vendor documentation fetched 2026-11-11, pages undated). The
  text layer has no such limit.

### Computing the scale from dimension chains

An experiment, scripts not committed: on synthetic vector sheets the scale computed
from the dimension chains is exact. It catches a sheet re-plotted to A4 (1:141
against a title block saying 1:100), a wrong title block, and a 3 % stretch in one
direction. On the real AutoCAD plot a quick heuristic failed: results cluster near
1:100 but 3 to 11 % off, because real chains share one long line and level marks
look like dimensions. No published method or benchmark exists for this on vector
files. It is real engineering, and it is not the first slice.

### How tight the rules are

A scout catalogued 48 dimensional requirements from the OIB-Richtlinien 2, 3 and 4
in the 2019 edition (the 2023 texts were not reachable, so values need checking
against the knowledge base). About 60 % can be decided from a floor plan; the rest
need a section or level marks. Thresholds sit on common design values: a corridor
drawn at exactly 1,20 m cannot be decided by measuring to ±2 cm. The printed figure
decides it, and where there is none, *nicht entscheidbar* is the honest answer.

### What others do

- **Table stakes everywhere:** two-point calibration from a known length, a scale
  per sheet, an offer to detect the printed scale, and length and area tools. Every
  vendor leaves verifying the scale to the user. None states a tolerance.
- **Planmetry** (takeoff for estimators, PDF only): scale suggested from title
  block, scale bar and dimension annotations, confirmed once by a person, checked
  against a second dimension by hand; snapping to walls; one-click area; counting
  a symbol from one example. Its takeoff lists and cost data are an estimator's
  product and not ours.
- **OpenTakeoff** was the engine the August note meant to borrow. Its licence
  changed from Apache-2.0 (up to 0.9.96, 2026-10-03) to AGPL-3.0-only (from 0.9.98,
  2026-10-11), the licence ADR-0152 rejected PyMuPDF for. Its scale is in feet. Its
  precision could not be tested: running the package was not permitted in the
  research session. Its design matches ticket 33 almost line for line and is worth
  copying: a detected scale is only a suggestion, the agent proposes and a person
  confirms, nothing is measured without a scale, and the agent is handed the vector
  linework.
- **Nobody found** checks dimensions from PDF plans against a code with a verified
  scale. Autodesk has announced a drawing compliance review for about 2027. These
  are vendor statements, not measurements.

## Decisions this plan takes

1. **One 2D measuring engine, two readers.** A vector PDF plotted from CAD and a DXF
   are the same thing: exact linework and text. A DXF names its unit; a PDF needs a
   scale. The DXF reader exists (`agent.drawings`, ezdxf). The PDF reader is new, on
   pdfplumber and shapely, both already dependencies. PyMuPDF and OpenTakeoff are
   out on licence.
2. **Geometry is read once, at ingestion,** and stored per Fassung beside the file,
   the way a rendition is. A question never parses a sheet.
3. **A scale belongs to a region of a page** and has a state: `verified` (a person
   set or confirmed it), `estimated` (proposed, with its source) or `uncalibrated`.
   Sources in order of trust: a person's two-point calibration; the scale stored in
   the file; the scale computed from dimension chains; the printed note with the
   sheet size. A person's value always wins and is never overwritten.
4. **The PDF viewer stays the one viewer.** A DXF keeps its to-scale PDF; because we
   draw it, measuring on it can use the DXF's own geometry and needs no calibration.
   pdf.js can switch PDF layers on and off, which covers most of the wish for a
   „true“ CAD view. A second, native DXF viewer waits until an office asks for it.
5. **PDF is not converted to DXF.** The conversion adds no information; the engine
   reads the same lines from the PDF. A DXF download of a sheet is a cheap extra
   later.
6. **Scans are a degraded mode that says so.** No raster resolution decides a 10 mm
   margin (the error budget of the August note stands). Phone photos are refused.

## The tools the agent has at the end

One native tool, `drawing_measure`, built like `ifc_measure` and `dxf_measure` and
offered to other agents on the door as `drawing-measure`. One tool with operations,
because every bound tool costs about a thousand tokens on every turn. The target is
that it absorbs `dxf_measure`, so the agent has one tool for 2D and one for 3D;
that move is costed before it is made.

Places are given as `look` gives them: a page and shares of the page.

### Reading (needs no scale)

| Operation | What it answers |
|---|---|
| `sheet` | What this page is: sheet size and format, vector or scan, its regions with each one's scale, state and source, the printed scale notes, the layers, how many dimension figures and room stamps it holds. The first call on a file. |
| `figures` | The printed figures in a region, exactly as written, each with its position and kind: dimension, level mark, opening size, room stamp. Finds by text („Gang“, „2,03“). States the unit convention it read. |
| `rooms` | The room stamps as rows: number, name, printed area, storey; and their sum. The feed for reconciling a plan with a list. |

### Measuring (needs a scale)

| Operation | What it answers |
|---|---|
| `clearance` | Two points laid across something. Returns every line the probe crosses and the distances between successive crossings: the clear width between two faces. It tolerates imprecise pointing, because the probe only has to cross both walls. |
| `distance` | Two points, each snapped to the nearest endpoint or intersection. Says whether it snapped. |
| `path` | The length of a polyline: an escape route, a boundary. |
| `area` | The area and perimeter of a polygon the caller gives. Later: the room enclosed at a point. |
| `count` | Later: every instance of a symbol, from one example. |

Each takes an optional `threshold` (a minimum or a maximum, from the Bestimmung the
agent looked up) and then returns a three-valued verdict computed from the interval,
so the model cannot round an interval into a pass:

- *erfüllt*: the whole interval clears the threshold;
- *nicht erfüllt*: the whole interval fails it;
- *nicht entscheidbar*: the interval straddles it, with what would resolve it.

### Scale

| Operation | What it answers |
|---|---|
| `scale_check` | Compares the sources for a region: the stored scale, the one computed from dimension chains, the printed note. Reports agreement, a contradiction, or a different scale in the two directions. |
| `drawing-calibration-propose` (a workspace operation, a write) | The agent proposes a scale for a region with its source. It lands as `estimated` until a person confirms it in the review view. Only a person makes a scale `verified`. |

### What every measuring answer carries

Value and unit; interval; provenance, one of `printed_figure`, `vector_verified`,
`vector_estimated`, `raster_estimated`; the place as a page region, so the answer
highlights it; the scale used, its state and source; and, when a printed figure lies
on the measured span, both values and whether they agree. On an `estimated` scale
the number comes with that caveat. On an `uncalibrated` region there is no number:
the answer names what is missing and leads to the calibration.

### Changes to tools that exist

- `look` returns, with a crop of a vector page, the text that lies inside the crop
  and the page's size and scale state. This alone makes reading printed figures
  exact, and it is the cheapest change in the plan.
- The annotation tools gain the shapes a measurement needs (a line, a path, a
  polygon) so the agent can leave what it measured on the sheet.
- `ifc_measure` reports a suspicion of a wrong length unit, from typical dimensions
  (storey height, door width).

## Slices

Each is shippable on its own and names the part of the star it serves.

| # | Slice | Serves | Size |
|---|---|---|---|
| 0 | **Measure first.** The corpus: 30 to 50 plot PDFs from the pilot offices. Count vector share, figures as text, stored scale, layers, unit conventions; how often the printed scale disagrees with the chains. Round-trip our own IFC fixtures for a precision figure. | every later choice | 2 days |
| 1 | **Sheet facts at ingestion.** Size, format, vector or scan, stored scale regions, layers, text with positions, the linework index, per Fassung. | „what is this sheet“ | M |
| 2 | **Exact reading.** `look` carries the text of its crop; `drawing_measure` with `sheet`, `figures`, `rooms`. Eval rows for figures and room-stamp sums. | the largest job: areas and lists; reading without the resolution limit | M |
| 3 | **Scale per region, with a person's confirmation.** The calibration record, its states, the two-point tool in the review view, the state shown on the file, the stored scale read from the file, refusal without a scale. A new Fassung inherits the previous scale as a proposal. | trust | M to L |
| 4 | **Measuring for the agent.** `clearance`, `distance`, `path`, `area`, the threshold verdict, the measurement left as an annotation. | widths, escape routes, the check against a Bestimmung | L |
| 5 | **Measuring for the person.** Distance, path and area in the review view, snapping to linework, saved as an annotation. Layer switching for PDFs that carry layers. | the tape on the sheet | M to L |
| 6 | **Computed scale.** From dimension chains, with the disagreement and stretch checks. | fewer manual calibrations | L, research-grade |
| 7 | **Later.** General DXF operations and paper-space layouts; DWG through a converter run as its own process; the room at a point; counting by example; area rules by standard; measurements exported as standard PDF measurement annotations. | reach | each its own |

Slices 1 and 2 need no scale at all and already change what offices feel. Slice 3
is ticket 33. Slices 4 and 5 are ticket 34.

Every slice follows the repo's own obligations: a person's capability is an operation
in the catalog first (headless first), a model call or a check is observable in
Langfuse, a customer-visible change gets a release note and screenshots, and a change
to what shapes an answer runs the answer suite before and after.

## How we will know it worked

1. **Slice 0 numbers**, before anything is built. They can change the order.
2. **Round trip on our own models:** export a plan from an IFC fixture, measure it,
   compare with the model. A real accuracy figure for our pipeline.
3. **Eval rows with ground truth:** a printed figure read exactly; a room-stamp sum;
   an undimensioned span measured within its stated interval; a refusal on an
   uncalibrated sheet; a contradiction between a printed and a measured value shown,
   not resolved; *nicht entscheidbar* on a span at the threshold.
4. **In use:** how often a scale is confirmed against proposed, how often a
   measuring answer rests on a verified scale, and whether offices stop leaving for
   CAD to measure. None of this is instrumented today.

## Deliberately not doing

| Not doing | Why |
|---|---|
| Asking a vision model for the dimension | A 2026 benchmark puts counting doors and windows at 40 to 55 % and did not even test dimensions. Right units, wrong number, stated with confidence. |
| Training a wall-segmentation model | Scored on recognition, not millimetres. |
| A takeoff product: lists, cost data, tool palettes | An estimator's product. Our users are planners. |
| Converting PDF to DXF or DWG as the route | Adds no information; no open library writes DWG well. |
| A second, native CAD viewer now | Annotations, citations, review and realtime would have to be rebuilt in it. |
| Straightening skewed scans | Report it; do not silently average. |
| Phone photos | Perspective on top of a raster budget that already cannot resolve 10 mm. |

## Open questions

1. **The corpus.** Everything above rests on fourteen files, two of them Archicad.
   Slice 0 needs the offices' real plots.
2. **Where a calibration lives.** Proposed: a record per document version, page and
   region, with who or what set it, when, and on which reference length.
3. **The disagreement threshold** between a calibration and a control length that is
   worth a warning. Needs a number from slice 0.
4. **The tolerance we state** for a measurement from vectors, and how line weight and
   the quality of the calibration enter it.
5. **Which wall face a width is measured to.** Structural and finished dimensions
   differ by centimetres, and the legend decides, not the engine.
6. **Folding `dxf_measure` into `drawing_measure`:** cost it before moving.
7. **The `measurement` source kind** is labelled „Modellmessung“ today. A
   measurement from a sheet needs its own label or a wider one.
8. **DWG demand.** One office receives DWG from consultants; nobody has asked to
   upload one. The usage data records no rejected upload, so the demand is unknown.

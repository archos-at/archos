# Measuring from drawings: the build specification

*Written 2026-11-11, revised the same day after an adversarial review against the
code. The companion of
[plan-measurement-from-drawings.md](./plan-measurement-from-drawings.md), which
says why and what. This says how, in what order, and what done means for each
slice. Where the two disagree, this file is newer and wins; the differences are
under [What changed against the plan](#what-changed-against-the-plan).*

**Slices 1 to 3 are built** (the reader, `look` returning the text in its crop,
scale and probe as pure functions, and the tool, dark), and of slice 7 the
ground-truth set, the release gate and the eval rows; the rest is not. Every path named as existing was read on 2026-11-11.
Every number under [Measured](#measured) was produced that day; the scripts were
research and are not committed.

## Measured

On real plan files, with libraries the backend already installs.

| Claim | Result |
|---|---|
| Linework and printed figures agree at the scale a file stores | On a public Austrian submission plan (AutoCAD plot, A0, page rotated 270°, eight stored scale regions): **39 of 42** dimension figures are matched by a pair of linework crossings within 0.5 % of the figure, at the region's stored scale. The misses are two stationing values, which are not spans, and one 0,40 m figure at 0.57 %. |
| The probe works at any angle | That sheet's site plan is drawn rotated by 20°; its figures match. |
| A fast reader gives the same geometry | pypdfium2's page-object API reproduces the 39 of 42. It reads that sheet's 64,606 segments in 0.4 s (pdfplumber: 3.4 s) and the heaviest sheet found, 1,234,452 segments on one A1, in 10.3 s (pdfplumber: 38 s). The research reader took every path point as a line end; see the Bézier rule below. |
| Rotated figures read in the right order | One Archicad file returns „581“ for a printed 185 in file order. Ordering characters by their position along the text matrix's advance direction returns 185, 190, 200, 135, 120. |
| The stored scale decodes per region | `/VP` viewports with a rectilinear `/Measure`, read through pdfminer: the first `X` number format's `C` is drawing units per point. With the unit read as metres the eight regions decode to 1:100 (five), 1:200, 1:500, and the sheet itself at 1 mm per mm. **The `U` label in that file is blank**: the unit is an assumption, which decision 5 turns into a check. |

Not measured, and each is a fixture the first slices must add: a page whose box
origin is not (0, 0); a `/UserUnit` other than 1; rotations 90° and 180°; a
stored region with `Y` or `CYX`.

## Facts about the readers

Checked against pypdfium2 5.14.0 and pdfminer as installed; the declared floor is
`pypdfium2>=5.12.1`.

* **PDFium gives geometry and characters, not page dictionary entries.** `/VP`,
  `/Measure`, `/UserUnit`, the boxes and optional content are read with pdfminer
  (it arrives with pdfplumber).
* **Path points come back in object space, characters in user space, neither
  relative to the crop.** A path point goes through its object's matrix first
  (`FPDFPageObj_GetMatrix`, which already holds every `cm` above it on the
  page; inside a form XObject the form's own matrix is composed on top). On a
  page with MediaBox `0 0 200 100` and CropBox `50 20 150 80`, `get_size()`
  answers `(100, 60)` and a point drawn at `(60, 30)` comes back as `(60, 30)`;
  its place on the page as shown is `(10, 50)`. Subtract the effective box's
  origin before anything else. pdfplumber reports that page as 200 × 100, so the
  two readers must never be mixed in one frame. *(Corrected in slice 1: the
  first draft said path points arrive in user space. A path under
  `2 0 0 2 0 0 cm` returns its points unscaled and the matrix beside them.)*
* **A Bézier segment arrives as three points** of type `FPDF_SEGMENT_BEZIERTO`:
  two control points and the end. Consume them in triples and take the chord from
  the previous point to the third. Treating each as a line end draws phantom lines
  through the control points.
* **A character's direction is its matrix.** `FPDFText_GetCharAngle` reports 270°
  for text whose matrix is `(0, 1, -1, 0)`, which advances upward. Use
  `FPDFText_GetMatrix` (`a`, `b`). That matrix does not hold the font size:
  the text height is `FPDFText_GetFontSize × hypot(c, d)`.
* **A character's extent along its line is its loose box**
  (`FPDFText_GetLooseCharBox`: the advance by the font's height). The tight box
  (`FPDFText_GetCharBox`) is the glyph's ink, and the gap after a „1“ then
  reads as a space: „185“ came back as „1 85“ (slice 1).
* **The page's box is `page.get_bbox()`** (`FPDF_GetPageBoundingBox`): the
  CropBox cut to the MediaBox, inherited from the page tree when the page has
  none, corners in order. `get_mediabox()` and `get_cropbox()` read the page
  dictionary only and answer US Letter for an inherited box, which many plots
  have (slice 1, found by the independent check).
* **A turned character's box is axis-aligned.** The loose box of text at 45° is
  the bounding box of the turned glyph rectangle, so its projection on the
  baseline is far longer than the advance. The advance is solved from the box's
  two sides and the angle (`reader._advance`); within about six degrees of 45°
  the two sides say the same thing and the glyph height is taken from the
  page's other text.
* **A stroke's width is in object space**: scale it by the object's matrix.
* **Known limits to state in the answer, not to hide:** an object cut by a clip
  path or on a hidden layer still comes back; a wall plotted as a filled polygon
  has edges and no stroke; AutoCAD SHX text is plotted as linework, so a vector
  page can have no characters at all.
* **PDFium is not thread-safe.** Every call holds `pdfium_lock`
  (`knowledge_layer.ingest.pdfium_lock`), which `look` shares. Copy raw points out
  under the lock in one pass and do all Python work outside it.

The frame mapping, after subtracting the box origin:

```python
def to_shown(x, y, width_u, height_u, rotate):
    """The page's own box, origin bottom left -> the page as shown, origin top left, y down."""
    if rotate == 0:
        return x, height_u - y
    if rotate == 90:
        return y, x
    if rotate == 180:
        return width_u - x, y
    return height_u - y, width_u - x  # 270
```

Verified in slice 1 for all four rotations, on a page whose origin is (0, 0) and
on a cropped one, against PDFium's own `FPDF_PageToDevice`
(`packages/knowledge-layer/tests/test_sheet_reader.py`).

## Decisions

1. **Geometry is read on demand, not at ingestion,** and kept in a bounded
   per-process cache, as `dxf_measure` keeps a site
   (`tools/drawings/source.py`). The differences from that cache are stated
   because they are where it would fail:
   * the key is `(bucket, object key, page)`;
   * the bound is on segments, not source bytes: at most 2,000,000 on one page (a
     page over that is refused with the reason) and 3,000,000 held in all;
   * the file's bytes are cached once per file, so a second page does not fetch
     150 MB again;
   * the cache is tenant data and is admitted only behind the BFF's scoped lookup
     on every call (`/api/internal/document-file`), the argument `source.py`
     makes for its own;
   * `look` reads characters only, never paths.
2. **The reader lives in `knowledge_layer`, the measuring in `agent`.**
   `packages/knowledge-layer/src/sheet/` holds everything that touches PDFium or
   pdfminer. Three things make that true rather than said:
   * the package lists its modules by hand (`packages/knowledge-layer/pyproject.toml`,
     `[tool.setuptools] packages`): add `knowledge_layer.sheet`, or it does not
     import;
   * `pdfplumber` and `pypdfium2` are declared only in that package's `llamaindex`
     extra and pdfminer arrives transitively: declare `pdfminer.six` beside them,
     as the file's own comments ask of every library imported directly;
   * the agent may not import `knowledge_layer` (`pyproject.toml`, contract
     `agent-knowledge-port`), and the contract counts annotation imports too. So
     the `Sheet` value and its parts are dataclasses in
     `agent/drawings/sheet_types.py`, `knowledge_layer.sheet` returns plain
     tuples and dicts, and `agent/tools/drawings/sheet_source.py` converts. One
     line joins the contract's `ignore_imports`:
     `agent.tools.drawings.sheet_source -> knowledge_layer.sheet`, with its
     reason, and the ADR records it. `agent/drawings/` imports nothing of
     `knowledge_layer`.
3. **One frame: the page as shown, in points, origin top left.** Places cross
   every boundary as shares of that page, as `look` and the annotations do. A page
   whose `/UserUnit` is not 1 is refused until handled.
4. **A scale belongs to a region and is `metres_per_point`.** The ratio a person
   reads is derived for display: `metres_per_point × 1000 × 72 / 25.4`.
5. **A number needs a scale that is a person's or is corroborated.** At a point,
   within the smallest region containing it, the scale is:
   * `verified` when a person's calibration covers the point;
   * `estimated` when the file's own figures corroborate a hint, where the hint
     is a stored region or a printed scale note that applies. **Every hint is
     checked, a stored region whose unit label names a unit included**: a file
     re-plotted with its viewports intact is otherwise believed. The answer names
     the hint and how many figures agreed;
   * `uncalibrated` otherwise. In particular: a hint the figures do not
     corroborate, a stored region with a `Y` array, a `CYX` factor or a subtype
     other than `RL`, two different scale notes with no stored regions, and a
     page without linework (a scan).

   **The corroboration check, defined.** One unit convention is fixed for the
   region before anything is matched (the one under which most figures parse),
   never per figure. A figure counts as a dimension when it parses under that
   convention and sits on a dimension line: a segment parallel to the figure's
   direction, within twice the figure's height of its centre, that ends in two
   terminators (a tick, an arrowhead or a crossing extension line). The figure
   agrees when the distance between those two terminators, at the hinted scale,
   is within 0.5 % of its value. No other pair of crossings counts: on a sheet
   of 64,606 segments some pair along any line matches any scale. The hint is
   corroborated when at least three figures agree **and** they are at least 80 %
   of the region's dimension figures. The 39 of 42 under [Measured](#measured)
   came from a looser match (any crossing pair around the figure); the first
   thing slice 2 does is repeat that measurement with this definition on the
   slice 1 fixtures and state the result. The stricter match has not been run on
   a real file. If it corroborates a correct scale on fewer fixtures than the
   looser one did, do not loosen the 80 % or the terminator rule to get green:
   report the numbers in the pull request, because the thresholds are then the
   product owner's call.
   **As built in slice 2, and what it measured.** The check is
   `agent/drawings/sheet_scale.py`; three points the definition left open were
   settled in the stricter direction:
   * *The dimension line* is the nearest parallel segment (within 3°, within
     twice the figure's height) that itself ends in two terminators, and its
     length is the span, whatever stops near it on the way. Only where no
     segment ends so (a chain drawn as one long line) is the nearest terminator
     on each side of the figure taken. Before this, on a real plot, a dimension
     set inside the drawing was cut short by wall hatching in 22 of 65 cases.
   * *A terminator* is a line that meets the dimension line and stops there:
     a tick, an extension line whose end lies within 1.5 text heights of it, or
     the tip of an arrowhead. A line that crosses and runs on ends nothing: the
     extension line of a chain further out crossed the inner chain's 5,50 span
     on the first fixture and made that figure disagree.
   * *The unit convention* is fixed from form alone, and only from figures
     that sit on a dimension line (one room number „1.05“ in a region otherwise
     switched a millimetre sheet to metres): decimals present, decimals are
     metres and whole numbers centimetres; no decimals but a raised digit,
     centimetres; whole numbers only, **undetermined**, and nothing is
     corroborated. Centimetres and millimetres differ by ten, and a scale note
     of 1:100 over a 1:10 detail dimensioned in millimetres would otherwise
     agree under the other reading. A decimal needs two or three decimals to be
     a length: „400,0“ and „2,5“ are read as nothing.
   * *A stored factor without a unit label* is read as metres only when
     something else on the sheet states the same ratio within one percent (the
     region's own ratio text, a printed scale note). A file drawn in
     centimetres with an empty label otherwise decodes a hundred times too
     large, and figures printed in centimetres agree with it.
   * *Corroboration is local.* Figures vouch for the part of the sheet they
     dimension: the dimension nearest the place asked about must be one that
     agrees, and an agreeing dimension must run past the place in two
     directions (the place's foot on that dimension's line falls within its
     span, 6 pt allowed at each end; two directions are 30° apart or more).
     Otherwise a second view at 1:50 under a note that says 1:100 was
     `estimated` on the strength of the other view's eight figures. Until
     slice 7 the rule was the extent of all agreeing dimensions grown by a
     quarter, and a view without dimensions between two dimensioned ones lay
     inside it. The cost: a sheet dimensioned in one direction only (heights
     in a section) is `uncalibrated` everywhere, and so is a place beside the
     chains, the dimension line itself included.
   * *An estimate is no finer than its check.* An `estimated` reading carries
     a relative error of at least 0.5 %, whatever decision 10 gives its source:
     a stored factor 0.4 % off is corroborated, and at 0.1 % its interval did
     not hold the true value. Since slice 7 it also carries what its figures
     pin: one figure pins the scale to its deviation plus half the step it is
     printed to („1,25“ over 1.254 m agrees with a scale 0.8 % off), and the
     error is what the three finest agreeing figures all pin it within
     (`Corroboration.pinned_error`).

   On the fixture floor (eight dimensions, drawn exactly) 8 of 8 agree on all
   four rotations, cropped, and in a view turned by 20°, and 0 of 8 at ×0.5,
   ×0.707, ×1.414 and ×2. The public sheet behind the 39 of 42 is not in the
   repository.

   **On real plots (measured 2026-11-11, three drawings of the dev workspace,
   fetched for the measurement and not committed):**

   | Sheet | What it holds | Strict match at the printed scale | At other scales |
   |---|---|---|---|
   | A basement floor, A1, 1:50, 1,970 segments, 201 figures | 65 dimension figures on dimension lines, note „1:50“, no stored region | **52 of 65 agree (80 %)**: `estimated`, exactly at the threshold | 0 of 65 at 1:100, 1:200 and 1:500 |
   | An elevation, A1, 1:50, 16,029 segments | 6 figures on dimension lines | 3 of 6: `uncalibrated` | 0 of 6 |
   | A ground floor, A1, 518,910 segments, read in 5.3 s | no dimension figure; the scale printed as „1.200“, which is no „1:N“ | no hint: `uncalibrated` | n/a |

   All 13 misses on the first sheet are short figures (20 to 44.5 cm) whose
   drawn span differs from the printed value by 1 to 5 mm; 12 of them lie
   within half the last printed digit: inside what a figure printed to the
   centimetre can say, outside 0.5 %. So the one real
   dimensioned floor plan is corroborated with nothing to spare, and a sheet
   like it with a few more short dimensions would not be. Three sheets from
   one office are not a corpus.

   **What print rounding does to the 0.5 % rule (measured 2026-11-11, synthetic).**
   Spans drawn to the millimetre, labelled as a drawing prints them, three
   sheets of about 100 figures each, correct scale:

   | Labels rounded to | Figures under 0.5 m that agree | From 0.5 m up | Sheets corroborated |
   |---|---|---|---|
   | the centimetre | 15 of 67 | 237 of 243 | 2 of 3 (the third at 79 of 101, 78 %) |
   | the half centimetre (raised 5) | 47 of 67 | 243 of 243 | 3 of 3 |

   A figure printed to the centimetre is exact to ±5 mm, which is more than
   0.5 % of anything under one metre. A sheet with many short dimensions can
   therefore be `uncalibrated` at its true scale. The thresholds were not
   changed. Whether agreement should allow half the last printed digit is the
   product owner's call, to be taken on real plots.
6. **Only a verified, uncontradicted scale can decide a threshold.** On
   `estimated` a length is returned with its caveat and the verdict is always
   `undecidable`, with „confirm the scale“ as the remedy. `uncalibrated` returns
   no length and no area. A verdict other than `undecidable` also needs what
   decision 9 asks of the span.
7. **A calibration's region is never the page by default.** It is the stored
   region containing both reference points when there is one; otherwise a box the
   person draws, which is a required step. Both points lie inside it. A
   calibration that disagrees with its stored region or with the figure check by
   more than the tolerance is saved and reported, and while it disagrees every
   verdict in its region is `undecidable`: two sources say different things and
   a person has to look. A calibration belongs to one version of a document;
   none carries over to a new version.
8. **A measurement never crosses two regions.** Both ends lie in one region, or
   the answer is undecidable and names both.
9. **The engine produces the one span.** `clearance` takes two points placed near
   the two faces. Each end is moved along the probe to the nearest linework
   crossing within 6 pt. If an end has two crossings within that radius, or none,
   the operation returns the crossings along the probe (each with its place,
   stroke width, dash state and colour) and no number; the caller then names the
   two by index (`between`). The answer carries the span, how far each end moved,
   and how many crossings lie strictly inside the span. The engine does not
   choose between structural and finished faces: the answer says „between
   linework as drawn“. Six points are 21 cm at 1:100 and the ends were placed by
   a model looking at a rendered crop, so **a verdict of `met` or `not_met`
   needs all of**: a verified scale (decision 6), no crossing inside the span,
   and either a printed figure on the span that agrees or the answer carrying
   the crop with the span drawn on it for the person. Anything less is
   `undecidable` with the reason.
   *As built:* between two parallel lines the probe meets squarely (65° or
   more) the span is the perpendicular between them, so a width does not grow
   because the two points were placed askew (at 1:100 a 10° slant adds 1.8 cm to
   1.20 m). Between lines that are not parallel it is the piece of the probe
   between them, the answer says so, and no verdict is given. `distance`, `path`
   and `area` move each point to the ONE line end or intersection within 6 pt
   and refuse two, listing them; a point that names a listed candidate (within
   0.05 pt of it, `ON_POINT_PT`) takes it. That was 1 pt until slice 7, and a
   point placed by hand near a corner took the hatch end beside it.
   No number comes from a point the engine could not tie to linework.
   *Refused outright:* a probe that meets either line flatter than 65° (past a
   25° slant the width was once taken along the probe and came out a tenth too
   long, with a verdict); a point with more than 60 lines within reach
   (hatching), where line ends and corners cannot be told apart; an area whose
   corners are out of order. A path that passes through a line between two of
   its points decides nothing, and a measurement that passes OVER another
   scale region is refused like one that ends in it: the scale is read at nine
   places along every leg, not at its ends alone.
10. **Tolerance, first version.** A length carries
    `max(widest end stroke at scale, value × relative_scale_error)`:
    `1 pt / reference_length_pt` for a two-point calibration, 0.001 for a stored
    region, 0.005 for a corroborated note. An area carries twice the relative
    error of its lengths. A threshold within `VERDICT_FLOOR_M = 0.02` of the value
    is `undecidable` whatever the interval: the face a width is measured to is
    unknown to centimetres. Slice 7 measures both constants.
    *As built:* an `estimated` reading carries at least 0.5 % (decision 5), and
    a length is never finer than 0.25 pt, the distance below which two lines
    are one. A calibration counts as contradicted by another calibration over
    the same place, by its stored region, by what the figures corroborate at
    that place without it, or by the figures inside its own region: any
    number of them, two included, and whole-number figures whose unit cannot
    be told under both readings (slice 7; before it fewer than three figures
    and whole centimetres contradicted nothing). What stays
    undetected: a calibration within 0.5 % of the truth where no stored region
    says otherwise, one ten times off over whole-number figures, and any
    calibration over a view without a dimension figure. The figure check
    cannot see finer, and the calibration's
    own stated error (one point over its reference length) is the person's.
    A contradicted calibration still states its length, at the calibration's
    scale and with its interval; only the verdict is withheld.
11. **Figures keep their text.** A figure is returned as printed, with its place,
    direction and height, and a parsed value only where the form is unambiguous. A
    figure is returned whole or not at all: one whose centre lies outside a crop is
    left out, never cut. A raised final digit stays in its figure, and a raised 5
    says the figure is printed to the half centimetre (its step is 0.005 m, not
    0.001 m: „4,96⁵“ stands for 4.9625 to 4.9675 m). The sheet's unit
    convention is an inference stated with its evidence, never applied silently.
12. **The tool is `drawing_measure`, separate from `dxf_measure`.** It is bound
    where the organization holds the feature and the project holds a PDF. Which
    PDF has a drawing page is not a fact Postgres has (`contentTypes` is read per
    collection from the Python backend), so the kind is „a PDF“, said plainly:
    the binding narrows by the feature, not by the file. The configured tools
    stand at 20,418 of a 20,900-token ceiling (`test_static_prefix_size.py`,
    2026-11-10), and that test counts every configured tool: the ceiling is raised
    by the tool's measured cost in the same change, and the description is held
    under 900 tokens. The same test holds a second ceiling for a project without
    a model, `TOOLS_WITHOUT_A_MODEL_CEILING = 11_300` at 10,360 measured: with
    the kind „a PDF“ nearly every project binds this tool, so it counts there
    too and that ceiling rises by the same measured cost, with „pdf“ added to
    the docstring's accounting. The door has a per-tool ceiling and an average
    one (1,070 at 1,063 measured) in `mcp-server.spec.ts`.
13. **Answers are records, not sources**, as for `dxf_measure` (ADR-0153).
    `workspace_records.py` holds `DRAWING_TOOL = "dxf_measure"` as one constant;
    it becomes a set.
14. **It ships dark, at two gates.** One entitlement, `drawing-measure`
    (`bff/authz/feature-flags.ts`, `FEATURE_FLAGS` and `FLAG_KINDS`). The chat
    binding is gated where the BFF computes the turn's model kinds. The door
    operation's exposure entry is
    `{ external: false, agent: 'native:drawing_measure', reason }` until the flag
    is retired: `backend-operations.ts` has no flag on an operation, so
    `external: true` would open it to every outside agent. `withheld` is the
    wrong form: it takes one of six categories (`WITHHELD_CATEGORIES`) and none
    means „dark behind a flag“. As built, a third check sits in the tool: it
    refuses a call the turn stated no `pdf` for (`turn_file_kinds.turn_states`),
    because a job's chat agent and `POST /v1/internal/tools/<name>` bind the
    boot set without the turn's scope. Deep research does not list the tool.
15. **New code lands in new modules.** `view_image.py`, `use-document-review.ts`,
    `document-review.tsx`, `review-page-layer.tsx` and `bff/annotations/service.ts`
    are over the size limit and may not grow (`ci/size_baseline.json`). They gain
    at most a call line, offset by an extraction.
16. **Names.** Never „plan“ for a file. No country in code or a prompt
    (`ci/country_tokens.json`): the tool takes a threshold as a number and never
    names the rule it came from. From migration 0190 on the helpers are
    `secure_table` and `current_org`.

## What changed against the plan

* Sheet facts at ingestion are deferred (decision 1). The first slice is the
  cheapest change: `look` returns the text in its crop.
* The plan let an estimated scale yield a number with a caveat. It still does, but
  only when the file's own figures corroborate it, and never a verdict
  (decisions 5 and 6).
* The plan's calibration record had three states; a calibration row is now always
  a person's, and its lifecycle is `active`, `superseded`, `withdrawn`.
* Computing a scale for a sheet that gives no hint stays out. Checking a hinted
  scale against the sheet's figures is in.

## The pieces

| Where | Holds |
|---|---|
| `knowledge_layer/sheet/reader.py` | `read_sheet(pdf_bytes, page_number)`, returning plain tuples and dicts: the page's box, rotation and size in points and millimetres, the ISO 216 format if within 3 mm, segments with a width, dash state and colour each, characters with box and matrix, the stored regions, whether the page is a scan. |
| `knowledge_layer/sheet/figures.py` | Characters into figures in reading order; nothing else. `look` uses this alone. |
| `knowledge_layer/sheet/crop_text.py` | The figures inside a crop, bounded, for `look`. |
| `agent/drawings/sheet_types.py` | `Sheet`, `Segment`, `Figure`, `StoredRegion`, the columnar `SegmentTable`, and `sheet_from_plain`, which turns the reader's plain values into them. No imports outside the standard library. (No `Character`: figures are grouped in the reader's package, and nothing in the agent reads single characters.) |
| `agent/drawings/sheet_scale.py` | Scale at a point by decision 5; the corroboration check; the ratio for display. |
| `agent/drawings/sheet_figures.py` | Classification of figures (dimension, level mark, opening size, scale note, room stamp) and the unit convention as an inference. |
| `agent/drawings/sheet_probe.py` | Crossings over a grid index of the segments, so a probe never scans a million of them; `clearance`, `distance`, `path`, `area`; snapping that returns the point and the distance moved and refuses two candidates; the tolerance. |
| `agent/drawings/sheet_answers.py` | The answer type, the verdict (`decide`) and the one function that renders it. |
| `agent/drawings/sheet_measure.py` | The four measuring operations: span or snapped points, the scale they share, the tolerance, the answer. Added in slice 2: the join of probe, scale and answer needed a home that is none of the three. |
| `agent/tools/drawings/sheet_source.py` | Loading through the scoped lookup, converting the reader's plain values into a `Sheet`, the cache of decision 1. |
| `agent/tools/drawings/measure_register.py` | The tool, modelled on `register.py` beside it. |
| `agent/drawings/sheet_listing.py` | The reading operations (`sheet`, `figures`, `rooms`, `scale_check`): what the file holds, with the sheet's own lines kept apart so the tool fences them. Added in slice 3. |
| `apps/workspace/bff/turn-context/project-models.ts` | The gate: a project's PDF is stated to the agent only where the organization holds `drawing-measure`. |

A measuring answer carries: value and unit; interval; `provenance`, one of
`printed_figure`, `vector_verified`, `vector_estimated`; the
place as page and shares; the scale with its state and source; a printed figure
lying on the span (its centre within the span's bounding box grown by the figure's
height, its direction within 10° of the span's), with whether it agrees; and, when
a threshold was passed, `met`, `not_met` or `undecidable`. An answer without
provenance and interval cannot be constructed. **A scan yields no length:** a
page without linework is `uncalibrated`, `sheet` says it is a scan, and the
agent goes on reading it with `look`. Measuring on a scan is not in this build.

| Operation | Arguments | Needs a scale |
|---|---|---|
| `sheet` | `document`, `page` | no |
| `figures` | `document`, `page`, `region`, `query`, `kind`, `limit` | no |
| `rooms` | `document`, `page`, `limit` | no |
| `scale_check` | `document`, `page`, `region` | no |
| `clearance` | `document`, `page`, `from`, `to`, `between`, `threshold_min`, `threshold_max` | yes |
| `distance` | the same without `between` | yes |
| `path`, `area` | `document`, `page`, `points`, thresholds | yes |

* `sheet`: size, format, rotation, whether it is a scan, the regions with each
  one's scale, state and source, and the unit convention with its evidence.
* `figures`: printed figures in a `region` (shares of the page), filtered by
  `query` (a substring of the printed text) or `kind` (`dimension`,
  `level_mark`, `opening_size`, `scale_note`, `room_stamp`, `other`), paged.
* `rooms`: the room stamps of a page, each as its printed lines (name, printed
  area, floor finish where printed) with its place. It reads what is printed and
  computes nothing.
* `scale_check`: runs decision 5's corroboration for a region and returns the
  hint, the figures that agreed and those that did not, each with its place.
* `between`: two indices into the crossings a refused `clearance` returned.

## Slices

One pull request each, against `develop`, green on its own. A slice's „done when“
is deterministic: tests the builder can run without a model key. Where a live run
is owed it is a separate line, to run when `OPENROUTER_API_KEY` is set and
otherwise to state as „not verified because“ in the closing checklist.

### 1. The reader, and `look` returns the text in its crop

* **Build:** `knowledge_layer/sheet/` (reader, figures, crop text), listed in the
  package's `packages` with `pdfminer.six` declared (decision 2); `look` calls
  it for characters only. The result gains the figures inside the crop and the
  page's size in millimetres and sheet format. Bounded, with a note when cut. A
  page with no characters says so, scan or not.
* **Fixtures:** a minimal PDF writer in the test helpers, extending
  `packages/knowledge-layer/testing/knowledge_layer_testing/pdf_fixtures.py`,
  that can set `/Rotate`, a CropBox with a non-zero origin,
  `/UserUnit`, `/VP` with `/Measure`, and text matrices at any angle. matplotlib
  cannot write those entries and is not a dependency of this package.
* **Mind:** text from a licensed copy reaches the model only inside a licensed
  hit (`look/register.py`, ADR-0164); the appended text takes that path or is left
  out, and stays off the look card.
* **Done when:** figures read back exactly on all four rotations and on a cropped
  page; „185“ is read, not „581“; a figure straddling the crop edge is left out
  whole; a raised final digit is kept; the result-text tests are updated
  (`tests/knowledge_layer_tests/test_view_image_region.py`, and the agent's
  `tools/look/test_register.py`, `test_question.py`, `test_place.py`); the
  vector variant of `scripts/turn_census/render_fixture_drawings.py` is built
  (its docstring names it as the later step: text and lines as page objects)
  and only then are vector rows added to `tests/fixtures/visual/drawings.json`
  beside the raster ones, which stay as they are.
* **Live, if a key is set:** `task be:eval:answer-suite -- --set visual` before
  and after.

### 2. Scale and probe, as pure functions

* **Build:** `sheet_scale.py`, `sheet_figures.py`, `sheet_probe.py`,
  `sheet_answers.py`. No tool.
* **Done when:** stored regions decode on all four rotations and on a cropped
  page; the 39-of-42 measurement is repeated with decision 5's match and its result
  stated; a hint is `estimated` only when corroborated and `uncalibrated`
  without, whatever its unit label says; the same sheet checked at ×0.5, ×0.707,
  ×1.414 and ×2 of its true scale is `uncalibrated` each time; a sheet of dense
  hatching with a wrong hint stays `uncalibrated`; a re-plotted sheet with its
  viewports intact is `uncalibrated`; a `Y` array is refused; a scan yields no
  length; a verdict with a crossing inside the span, or with neither an agreeing
  figure nor a crop, is `undecidable`; a probe between two known faces, its ends jittered by a seeded loop,
  returns the drawn value inside its interval every time; an end with two
  crossings in reach returns the crossings and no number; each of the three
  verdicts is produced by a fixture; a verdict on `estimated` is `undecidable`;
  constructing an answer without provenance fails.

### 3. The tool

* **Build:** `sheet_source.py`, `measure_register.py`, the binding, the records,
  the door operation as `withheld`.
* **Every list that names a tool:** the `nat.plugins` entry point in
  `packages/agent/pyproject.toml`; `configs/config_oib_openrouter.yml` (the
  function block and both tool lists); `common/backend_tools.py`;
  `common/tool_calls.py`; `common/workspace_records.py`;
  `agents/piloti/turn_tools.py` (`_MODEL_KIND_OF_TOOL`); <!-- brand-history -->
  `turn/context_client.py` (`_model_kinds` hard-codes `ifc` and `dxf`);
  `apps/workspace/bff/turn-context/wire.ts` (a strict object of `ifc` and `dxf`)
  and its service; `bff/bim/model-kinds-repository.ts`;
  `bff/agent-api/backend-operations.ts`, `exposure.config.ts`,
  `tests/fixtures/exposure.json`, `backend-tools.schema.json`
  (`scripts/generate_backend_tools_schema.py`);
  `ui/features/chat/lib/executed-steps.ts` and its copy in every dictionary;
  both token ceilings of `test_static_prefix_size.py` and both of
  `mcp-server.spec.ts` (decision 12);
  `agents/piloti/AGENTS.md`. <!-- brand-history -->
* **Mind:** the turn-context wire is strict, so a new field needs the BFF and the
  agent to roll in an order the pull request states.
* **As built:** the roll order does not matter. The strict schema is the BFF's
  own answer; the agent reads `projectModels` key by key. An older agent
  ignores `pdf`. A newer agent with an older BFF finds no `pdf` and leaves the
  tool unbound, and so does an unknown answer (null): for this one kind
  "unknown" must not bind, or it would hand the tool to an organization without
  the entitlement. The door operation is `external: false` with a reason, not
  `withheld`, as decision 14 says (this slice's "Build" line said `withheld`).
  No verdict other than `undecidable` comes out of this slice: nothing is
  `verified` until a calibration is read (slice 4), and no crop is attached
  until the card exists (slice 6). `scale_check` without a region checks every
  stored region, since the page's middle is often in none.
* **Done when:** `test_chat_tools_are_classified.py`,
  `test_collection_read_inventory.py`, `test_register_decisions.py`,
  `test_static_prefix_size.py`, `test_context_client.py`,
  `test_backend_tools_schema.py`, `backend-operations.spec.ts`,
  `discovery.spec.ts`, `mcp-server.spec.ts` and
  `model-kinds-repository.integration.spec.ts` are green; a turn in an
  organization without the feature does not bind the tool; a read reports its
  collection and a refused lookup reads no bytes, as `test_dxf_measure.py` holds
  for its tool.

### 4. A person's calibration, headless

* **Build:** migration and table `drawing_calibrations` (organization, document,
  version, page, region as shares, `metres_per_point`, the two reference points
  and their true length, who and when, status) under `secure_table`; the lifecycle
  `active`, `superseded`, `withdrawn` declared with `defineLifecycle` and
  registered, with `withdrawn_at` and `withdrawn_by`; a partial unique index for
  one active row per region; withdrawing does not revive what it superseded. Read
  through a `DocumentReader` with `documentVisibleTo`. Routes to list, set and
  withdraw, their catalog operations and exposure; an internal read for the tool.
  Listing checks `project:view`, setting and withdrawing check
  `project:documents:write`: no new permission. A document with no version row has
  no calibration and says so; a new version starts with none.
* **Done when:** `task db:test:rls` is green with the table's block in
  `scripts/rls-test-db.sh` and an integration spec as the runtime role; a
  calibration makes the tool answer `vector_verified` inside its region and leaves
  the neighbouring region as it was; a calibration contradicting a stored region
  or the figure check is reported and makes every verdict in its region
  `undecidable`; the list operation pages.

### 5. Calibrating in the review view

* **Build:** a `calibrate` tool beside select, point, region and ask, in new
  modules; two points, a length, the region taken from the stored region or drawn,
  the resulting ratio shown before saving; the scale state on the file listing and
  beside the page's readings; a `/dev/` preview; the `surface-parity` entry.
* **Done when:** a spec beside each new module holds: two clicks and a length
  produce the ratio shown before saving; the region is the stored one when both
  points lie in it and otherwise must be drawn; saving calls the set operation
  once with shares of the page; withdrawing returns the page to its earlier
  state; `parity.config.spec.ts` is green with the new entry. Captures of the
  `/dev/` preview are on the pull request.

### 6. The card that asks a person to confirm a scale

* **Cost first** (root `AGENTS.md`, „Cost a move before you build it“). The
  existing `operation` proposal kind already turns an agent's call of a write
  operation into a card a person applies. With the set operation of slice 4, the
  agent's proposal is that card, and the person confirms or dismisses it with no
  new kind. What it lacks is the crop with the reference span and changing the
  value in the card. Write the four answers for both routes: the `operation` kind
  with a richer receipt body, and a fifth kind `drawing_scale`. **The builder
  builds on the `operation` kind.** A fifth kind is the product owner's
  decision: if the costing says the `operation` kind cannot carry the crop, stop
  at the costing and put it to them in the pull request.
* **Build, either way:** the answer on an `estimated` or `uncalibrated` region
  carries the card; the receipt shows the crop (`PageRegionThumbnail`), the
  proposed ratio, its source and how many figures agreed; the person confirms,
  dismisses, or opens the sheet with the calibrate tool pre-filled. A region
  with no hint at all has no ratio to propose: its card shows the crop and
  offers the calibrate tool only. The decision
  reaches the next turn (`proposal-decisions.ts`: `describePayload` returns `null`
  for a kind it does not know). The card is `live` in `CARD_INTERACTIVITY`, with
  its case in the live-card ratchet.
* **Then, if the costing clears it:** the value changed in the card itself. No
  proposal card has an input today; the one precedent for a decider changing what
  is applied is a second button.
* **Done when:** specs hold that an answer on an `estimated` region carries one
  proposal and a second call does not open a second; that applying it writes one
  active calibration as the decider; that a dismissed proposal writes none; that
  the next turn's decisions block names the outcome; the live-card ratchet has
  its case.
* **Also:** `docs/architecture/proposed-changes.md` line 45 puts the `operation`
  kind in migration 0176 while line 95 says 0175. Read both migrations and make
  the document say what they do.

### 7. Proof and counting

* **Build:** the ground-truth set: sheets written by the slice 1 writer at known
  dimensions, with what real sheets carry (hatching, door swings, furniture,
  dimension chains, two regions at different scales, a rotated view), each
  measured and compared with the value it was drawn at. An IFC round trip is
  not in this build: the one drawing function is `ifc_spatial.tools_analysis.draw`,
  it writes SVG or PNG, and `packages/ifc-spatial-py` keeps its own lockfile
  outside the workspace. Then eval rows
  with ground truth; product events for a calibration set and a proposal decided
  (`captureServer`, `ServerEvent`, `docs/observability/posthog-events.md`); the
  tolerance constants and the verdict floor checked against that set, with the
  measurement in the pull request. Synthetic sheets measure the engine, not the
  drafting: the constants stay provisional until the pilot offices' files are
  measured (see the last section).
* **Release gate:** on the eval set, no answer states a number whose true value
  lies outside its stated interval.
* **As built (2026-11-11): the set, the gate and the counting; not the events, not the score.**
  The set is `knowledge_layer_testing.ground_truth_sheets` (17 sheets, each a
  `FloorView` of `ground_truth_views.py` drawn at known dimensions: hatched
  walls, a door swing, furniture, two rows of dimension chains), and every
  probe carries the value it was drawn at. `agent_testing.ground_truth` asks
  each probe through `sheet_measure` as placed and with every point moved by
  up to 1 and 2 pt (seeded), without a calibration and with a correct one.
  `packages/agent/tests/drawings/test_ground_truth.py` holds the gate;
  `scripts/drawing_ground_truth_report.py` prints the counts below and takes
  a few minutes. The product events and the Langfuse score are not built.

  **The gate holds: 0 of 352 numbers without a calibration and 0 of 719 with
  one state an interval that misses the true value**, and 0 of 2,710 verdicts
  given with a correct calibration are wrong. It did not hold when the set was
  first run. Five things were found and closed in the stricter direction:

  | Found | What was stated | Now |
  |---|---|---|
  | A 1:50 view without dimensions between two dimensioned 1:100 views, one note „1:100“ | 3.60 m for 1.80 m, `estimated`: the view lay inside the extent of its neighbours' agreeing dimensions (55 numbers, each twice the true value) | No number. An agreeing dimension must run past the place in two directions (decision 5) |
  | Thirteen equal bays of 1.254 m printed „1,25“, plotted at 99.2 % under a note „1:100“ | 9.952 ± 0.050 m for 10.032 m: 13 of 15 figures agree with a scale 0.8 % off, and ±0.5 % was stated (17 numbers) | The interval is what the figures pin: ±0.89 % here (decision 5) |
  | A printed figure „4,96⁵“ over a span drawn 4.967 m, in a region without a scale | 4.965 ± 0.0005 m | ± 0.0025 m: a raised 5 is the half centimetre (decision 11) |
  | A calibration at twice the true scale on a sheet with two dimension figures, or on one dimensioned in whole centimetres | `met` and `not_met`: 28 of 56 verdicts wrong on the whole-centimetre sheet | Contradicted, `undecidable` (decision 10) |
  | A point placed by hand 2 pt from a corner, within 1 pt of the hatch end beside it | The distance to the hatch end, ± the stroke: 13 of 5,360 numbers at 2 pt, 26 of 5,335 at 3 pt (twelve seeds) | Refused, the candidates listed: 0 of 5,313 and 0 of 5,269 (decision 9) |

  **What the two-direction rule costs on a real plot.** The one real
  dimensioned floor plan measured in slice 2 (a basement floor, A1, 1:50, 52 of
  65 figures agreeing) was asked for its scale at a 30 by 30 grid of places
  over the page, margins included. Before the rule: 514 of 900 places
  `estimated`. With it: 131 of 900. The other 383 now answer „uncalibrated: no
  agreeing dimension runs past this place in two directions“ and need a
  person's calibration. No threshold was loosened to win them back; whether the
  rule is too strict for real drafting is the product owner's call, on the
  pilot offices' files.

  What the set costs in refusals, by sheet (a probe is counted once as placed
  and six times moved):

  | sheet | probes | numbers, no calibration | of them outside | numbers, calibrated | of them outside |
  |---|---|---|---|---|---|
  | stored_region | 91 | 30 | 0 | 30 | 0 |
  | note_only | 91 | 80 | 0 | 80 | 0 |
  | two_regions | 196 | 46 | 0 | 46 | 0 |
  | two_views_one_note | 196 | 1 | 0 | 46 | 0 |
  | undimensioned_detail | 266 | 62 | 0 | 107 | 0 |
  | rotated_view | 91 | 32 | 0 | 32 | 0 |
  | centimetres | 91 | 34 | 0 | 34 | 0 |
  | centimetres_whole | 91 | 0 | 0 | 35 | 0 |
  | wrong_note | 91 | 1 | 0 | 35 | 0 |
  | wrong_stored_region | 91 | 0 | 0 | 32 | 0 |
  | replotted_a2 | 91 | 0 | 0 | 29 | 0 |
  | replotted_to_fit | 91 | 0 | 0 | 31 | 0 |
  | print_rounded | 91 | 0 | 0 | 30 | 0 |
  | print_rounded_long | 91 | 33 | 0 | 33 | 0 |
  | half_centimetre_labels | 91 | 1 | 0 | 34 | 0 |
  | equal_bays_to_fit | 91 | 31 | 0 | 31 | 0 |
  | two_dimensions_only | 91 | 1 | 0 | 54 | 0 |
  | ALL | 1932 | 352 | 0 | 719 | 0 |

  Why no number was stated:

  | why no number | no calibration | calibrated |
  |---|---|---|
  | span not picked: several lines in reach of an end | 604 | 604 |
  | point not tied: several line ends in reach | 524 | 524 |
  | no scale: the hint is not corroborated by the figures | 288 | 0 |
  | span not picked: no line in reach of an end | 49 | 49 |
  | span not picked: a line met too flat | 30 | 30 |
  | no scale: the hint is corroborated elsewhere, not here | 49 | 0 |
  | no scale: the figures' unit cannot be told | 35 | 0 |
  | touches two scale regions | 1 | 6 |

  With a calibration, 1,128 of the 1,213 refusals are the engine declining to
  pick between lines: 3 pt hatching puts a second line within 6 pt of nearly
  every wall face and corner. On `note_only`, which is not hatched, 80 of 91
  probes are answered; on `stored_region`, the same floor hatched, 30 of 91.
  That is the price of decision 9 on a hatched sheet, and it is high.

  How far a stated value lies from the truth, as a share of the half interval
  stated: all 719 `vector_verified` values within 0.001; of 343
  `vector_estimated` values 313 within a quarter and 18 between three quarters
  and one (the sheets whose scale is truly a little off), worst 0.913; of 9
  `printed_figure` values worst 0.8.

  **A less steady hand than the set's** (a correct calibration, four seeds):

  | every point moved by up to | probes | numbers | of them outside |
  |---|---|---|---|
  | 1 pt | 5520 | 1818 | 0 |
  | 2 pt | 5520 | 1764 | 0 |
  | 3 pt | 5520 | 1724 | 0 |
  | 4 pt | 5520 | 1591 | 1 |
  | 6 pt | 5520 | 906 | 21 |
  | 9 pt | 5520 | 331 | 49 |

  Past the snap radius a placed point is out of reach of its face and in
  reach of another line (a bed 20 cm from a wall), and the engine measures to
  that. The answer names the points and how far each moved; it cannot know
  what was meant. This is not closed, and it is why a verdict needs the crop.

  **The constants at half and at double** (no constant was changed):

  | constant | value | numbers, no calibration | outside | refused | numbers, calibrated | outside | refused | verdicts given (calibrated) | wrong verdicts |
  |---|---|---|---|---|---|---|---|---|---|
  | AGREEMENT_TOLERANCE | 0.0025 | 290 | 0 | 1642 | 719 | 0 | 1213 | 2394 | 0 |
  | AGREEMENT_TOLERANCE | 0.005 (as built) | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | AGREEMENT_TOLERANCE | 0.01 | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | MIN_AGREEING | 2 | 405 | 0 | 1527 | 719 | 0 | 1213 | 2710 | 0 |
  | MIN_AGREEING | 3 (as built) | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | MIN_AGREEING | 6 | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | MIN_AGREEING_SHARE | 0.4 | 408 | 0 | 1524 | 719 | 0 | 1213 | 2856 | 0 |
  | MIN_AGREEING_SHARE | 0.8 (as built) | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | MIN_AGREEING_SHARE | 1 | 322 | 0 | 1610 | 719 | 0 | 1213 | 2710 | 0 |
  | SNAP_RADIUS_PT | 3 | 453 | 6 | 1479 | 914 | 10 | 1018 | 2778 | 0 |
  | SNAP_RADIUS_PT | 6 (as built) | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | SNAP_RADIUS_PT | 12 | 298 | 0 | 1634 | 601 | 0 | 1331 | 2307 | 0 |
  | VERDICT_FLOOR_M | 0.01 | 352 | 0 | 1580 | 719 | 0 | 1213 | 2732 | 0 |
  | VERDICT_FLOOR_M | 0.02 (as built) | 352 | 0 | 1580 | 719 | 0 | 1213 | 2710 | 0 |
  | VERDICT_FLOOR_M | 0.04 | 352 | 0 | 1580 | 719 | 0 | 1213 | 1700 | 0 |

  Read with care, the set is small. The tolerance halved loses 62 numbers
  (the two sheets whose labels are rounded to the centimetre) and doubled
  gains none; no value makes a number wrong, because an estimate's interval
  follows the tolerance. `MIN_AGREEING` at 2 answers the one sheet with two
  figures, correctly. `MIN_AGREEING_SHARE` at 0.4 answers the sheet where
  half the figures disagree by rounding, correctly. Only the snap
  radius at 3 pt breaks the gate: the set moves a point by up to 2 pt from a
  place 2.5 pt inside the face, and at 3 pt that point reaches a neighbour and
  not its face. At 12 pt more is refused and nothing is wrong. The verdict
  floor changes no number; at 0.04 it withholds 1,010 verdicts, at 0.01 it
  gives 22 more, none wrong, on sheets drawn exactly. Nothing here says the
  floor is right for a drawn wall: synthetic faces have no finish layer.
* **Eval rows:** four `measure` rows in
  `tests/fixtures/visual/visual_questions.yaml` ask about EP-04, the set's
  `note_only` sheet written into the visual eval's fixture project
  (`"render": "ground_truth"` in `drawings.json`). `mentions` cannot say „a
  number near the truth, or no number and confirm the scale“, so a row
  carries `expect.measure` (`scripts/turn_census/measure_answers.py`), held to
  the set by `tests/test_visual_eval.py`. The rows have not been run against a
  model: the suite's fixture turn does not yet state the entitlement and the
  `pdf` kind the tool is bound by.
* **Needs the product owner:** a Langfuse score is declared in code and published
  with `task langfuse:provision -- --apply`.

### 8. A measurement kept on the sheet, and the person's tape

* **Build:** annotation shapes `line`, `path` and `polygon` with a points array;
  distance, path and area in the review view, snapping through a route that serves
  the engine's snap points for a page region.
* **Done when:** a spec holds each shape's schema bounds and that an annotation
  with a points array round-trips through create, list and delete; the snap
  route has its operation and exposure entry and refuses a document the reader
  may not see; a measurement drawn by a person shows the same value, interval
  and provenance the tool returns for the same points; captures are on the pull
  request.

### Not in this build

Computing a scale for a sheet that gives no hint; sheet facts at ingestion; layer
switching; one merged drawing tool; DWG; the room at a point; counting by example;
area rules by standard; straightening a scan.

## What every pull request owes

* A Conventional Commits title; the closing checklist of
  [`definition-of-done.md`](../contributing/definition-of-done.md), every line
  filled, including the revert check.
* `task verify:fast` and `task lint:repo` green. `task db:test:rls` for slices 4
  and 6. `task pkg:test` when `packages/` is touched.
* A release note from the first slice a customer could notice with the feature on;
  before that the `no-release-note` label with the reason.
* Every route a person calls has its operation and exposure entry; every list
  operation takes `limit` and `cursor`.
* Docs in the same change: `agent-tool-surface.md`, `agent-surface.md`,
  `where-is-what.md`, one ADR for the reader and tool and one for the calibration
  record (numbers from `scripts/check_adrs.py --next`), and what was learned.

## What needs the product owner

* Creating the `drawing-measure` flag in both WorkOS environments.
* Running a migration against a database the builder did not create.
* Publishing a Langfuse score.
* A model key in the build environment, for the live eval runs.
* Plan files from the pilot offices: the sample behind this spec is fourteen
  files, two of them Archicad plots, and Archicad stores no scale, so for those
  offices everything rests on decision 5's figure check and on calibration.
* Ticket 33 says the scale is per page. This builds per region.

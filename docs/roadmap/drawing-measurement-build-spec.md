# Measuring from drawings: the build specification

*Written 2026-11-11. The companion of
[plan-measurement-from-drawings.md](./plan-measurement-from-drawings.md), which
says why and what. This says how, in what order, and what done means for each
slice. Read the plan first; where the two disagree, this file is newer and wins,
and the difference is listed under [What changed against the plan](#what-changed-against-the-plan).*

**Nothing here is built.** Every path named as existing was read on 2026-11-11.
Every number under [Measured](#measured) was produced that day by the experiments
described there; the scripts were research and are not committed.

## Measured

On real plan files, with the libraries the backend already installs.

| Claim | Result |
|---|---|
| Linework and printed figures agree at the scale a file stores | On a public Austrian submission plan (AutoCAD plot, A0, page rotated 270°, eight stored scale regions): **39 of 42** dimension figures are matched by a pair of linework crossings within 0.5 % of the figure, at the region's stored scale. The three misses are two stationing values, which are not spans, and one 0,40 m figure at 0.57 %. |
| The probe finds what a person would measure | The same test is the probe: a line laid along a figure's reading direction, its crossings with the linework, and the gap between two of them. It works at arbitrary angles; that sheet's site plan is drawn rotated by 20°. |
| A fast reader gives the same geometry | pypdfium2's page-object API reproduces the 39 of 42. It reads that sheet's 64,606 segments in 0.4 s (pdfplumber: 3.4 s) and the heaviest sheet found, 1,234,452 segments on one A1, in 10.3 s (pdfplumber: 38 s). |
| Rotated figures read in the right order | One Archicad file returns „581“ for a printed 185 in file order. Ordering characters by their position along the text matrix's advance direction returns 185, 190, 200, 135, 120. |
| The stored scale decodes per region | `/VP` viewports with a rectilinear `/Measure`: the first `X` number format's `C` is drawing units per point. With the unit read as metres the eight regions decode to 1:100 (five), 1:200, 1:500, and the sheet itself at 1 mm per mm. The `U` label in that file is blank, so the unit is an assumption the printed scale notes confirm. |

Two traps found and to be avoided:

* `FPDFText_GetCharAngle` reports 270° for text whose matrix is `(0, 1, -1, 0)`,
  that is, text advancing upward. Take the direction from `FPDFText_GetMatrix`
  (`a`, `b`), never from the angle.
* A viewport's `BBox` is in unrotated user space with the origin bottom left; the
  rest of the product addresses a page as shown, origin top left
  (`view_image.py`, „shares of the page AS SHOWN“). The mapping is:

  ```python
  def to_shown(x, y, width_u, height_u, rotate):
      """Unrotated user space (origin bottom left) -> the page as shown (origin top left, y down)."""
      if rotate == 0:
          return x, height_u - y
      if rotate == 90:
          return y, x
      if rotate == 180:
          return width_u - x, y
      return height_u - y, width_u - x  # 270
  ```

  Verified for 0° and 270°. 90° and 180° follow by symmetry and need a fixture.

## Decisions

Each closes an open question of the plan.

1. **Geometry is read on demand, not at ingestion.** The engine reads a sheet when
   a tool first asks, and keeps it in a bounded per-process cache keyed by the
   version's object key, exactly as `dxf_measure` keeps a site
   (`tools/drawings/source.py`: `CACHE_SIZE`, `CACHE_BYTES`, `PARSE_TIMEOUT_S`).
   First-call cost measured: 0.4 s typical, 10 s worst seen. This removes the
   ingestion change, a storage format and an answer-suite risk from the first
   build. Storing sheet facts beside the version (`_sheet/` under
   `derivedSiblingKey`, written like `_text/`) is a later optimisation, taken only
   if first-call latency shows in use.
2. **The reader is pypdfium2**, under `pdfium_lock`
   (`knowledge_layer.ingest.pdfium_lock`; PDFium is not thread-safe). Paths come
   from the page-object API, recursing into form objects and multiplying matrices.
   A Bézier segment is taken as the chord between its end points: PDFium exposes
   no control points, and Archicad already plots arcs as polygons. Text comes from
   the text page: character boxes and matrices. pdfplumber stays what ingestion
   uses it for.
3. **One coordinate frame: the page as shown, in points, origin top left.** Places
   cross every boundary as shares of that page, as `look` and the annotations
   already do.
4. **A scale belongs to a region and is `metres_per_point`.** The ratio a person
   reads („1:100“) is derived for display: `metres_per_point × 1000 × 72 / 25.4`.
5. **A calibration row is always a person's.** Table `drawing_calibrations` holds
   only what a person set or confirmed, so it needs no lifecycle: a new row for the
   same region supersedes the old one, which is kept. An *estimated* scale is never
   stored. It is derived at read from, in order: the region the file stores; the
   printed scale note together with a standard sheet size. A proposal waiting for a
   person lives in `proposed_changes`, not here.
6. **The states a tool reports** are `verified` (a calibration row covers the
   point), `estimated` (derived, with its source) and `uncalibrated`.
   `uncalibrated` returns no length and no area.
7. **A measurement never crosses two regions.** Both ends must lie in one region,
   or the answer is undecidable and names both.
8. **Tolerance, first version.** A length carries
   `max(line_width_m, value × relative_scale_error)`, where `line_width_m` is the
   widest stroke the probe ended on, at scale, and `relative_scale_error` is
   0.001 for a scale stored in the file, `1 pt / reference_length_pt` for a
   two-point calibration, and 0.01 for a printed note. An area carries twice the
   relative error of its lengths. This is a stated first version; the round trip of
   slice 6 replaces the constants with measured ones.
9. **The engine does not choose a wall face.** `clearance` returns every crossing
   and every gap along the probe, in order, with each crossing's stroke width. The
   answer says „between linework as drawn“. Structural against finished dimensions
   is the legend's and the agent's to state.
10. **Figures keep their text.** A figure is returned exactly as printed, with its
    place and reading direction, and a parsed value only where the form is
    unambiguous („6,50“ is 6.50 with the sheet's length unit). The unit convention
    of a sheet (metres with a comma, millimetres as integers, centimetres) is
    reported as an inference with what it was inferred from, never applied
    silently.
11. **The tool is `drawing_measure`, separate from `dxf_measure`, and bound by
    what the project holds.** `turn_tools.py` binds a measuring tool only where
    the project holds a file of its kind (`_MODEL_KIND_OF_TOOL`: `ifc`, `dxf`;
    the kinds come from `bff/bim/model-kinds-repository.ts` through the turn
    context). `drawing_measure` joins that table under a new kind for a PDF with
    a drawing page, which the listing already knows (`contentTypes` holds
    `drawing`). The configured tools stand at 20,418 of a 20,900-token ceiling
    (`test_static_prefix_size.py`, measured 2026-11-10) and that test counts
    every configured tool, bound or not: the ceiling is raised by the tool's
    measured cost in the same change, with the number, and the description is
    held under 900 tokens. Folding the two drawing tools into one is costed
    separately and is not part of this build.
12. **Answers are records, not sources.** As for `dxf_measure`
    (`common/workspace_records.drawing_record`, ADR-0153): a computed length is not
    a passage a `[N]` resolves to. The `measurement` source kind stays the model's.
13. **It ships dark.** One entitlement flag, `drawing-measure`
    (`bff/authz/feature-flags.ts`, `FEATURE_FLAGS` and `FLAG_KINDS`), gates the
    routes, the review-view tools and the tool's binding. Creating the flag in
    WorkOS is the product owner's step.
14. **Names.** Never „plan“ for a file (`forbidden-file-words.spec.ts`,
    `test_product_framing.py`): drawing, sheet, page. No country in code or a
    prompt (`ci/country_tokens.json`): the tool takes a threshold as a number and
    never names the rule it came from.

## What changed against the plan

* The plan's slice 1 (sheet facts at ingestion) is deferred by decision 1. The
  first slice is now the cheapest change: `look` returns the text in its crop.
* The plan lists `scale_check` and the computed scale from dimension chains. The
  check against the file's own figures is in (it is the validation measured
  above, and it is how a contradiction is reported). Computing a scale for a
  sheet that stores none stays out: on such a sheet a person calibrates.
* The plan's calibration record had three states. By decision 5 it has none.

## The engine

Pure Python, no I/O beyond the bytes it is handed, in
`packages/agent/src/agent/drawings/`, beside the DXF site model it will one day
share operations with. Every function is small and testable on a synthetic sheet.

| Module | Holds |
|---|---|
| `sheet_reader.py` | `read_sheet(pdf_bytes, page_number) -> Sheet`: size in points and millimetres, rotation, the standard sheet format if any (ISO 216 within 3 mm), segments as a float array with a stroke width each, characters, stored regions, whether the page is vector or a scan (raster coverage, as `page_triage` judges it). Refuses a page over a segment cap with the reason. |
| `sheet_figures.py` | Characters into figures in reading order (the matrix rule above), each with text, centre, direction and height; classification as dimension, level mark, opening size, scale note, room stamp or other; the sheet's unit convention as an inference. |
| `sheet_scale.py` | Stored regions decoded and mapped to the page as shown; printed scale notes; the scale at a point from, in order, a calibration, a stored region, a printed note with a standard sheet; the smallest region containing a point wins. |
| `sheet_probe.py` | Crossings of a segment with the linework (a uniform grid index over the segments, so a probe does not scan a million of them); `clearance`, `distance` with snapping to the nearest end point or intersection within a radius, `path`, `area` (shapely); the tolerance of decision 8. |
| `sheet_answers.py` | The answer type: lines of text as `SiteAnswer` has them, `decidable`, and the fields below. One function renders it; nothing else formats a number. |

The answer of a measuring operation carries: the value and unit; the interval;
`provenance`, one of `printed_figure`, `vector_verified`, `vector_estimated`,
`raster_estimated`; the place as page and shares; the scale used with its state
and source; any printed figure lying on the measured span, with whether it agrees
within the interval; and, when a threshold was passed, the verdict `met`,
`not_met` or `undecidable` computed from the interval. A type test holds that an
answer without provenance and interval cannot be constructed.

## The tool

`packages/agent/src/agent/tools/drawings/measure_register.py`, modelled line for
line on `register.py` beside it: a pydantic input, a pure `answer(sheet, …)`, a
`run_*` that writes one `ActionRow`, loads through the scoped lookup
(`/api/internal/document-file`, the turn's signed envelope, `note_collections_read`)
and settles the outcome. Offered on the door as `drawing-measure`
(`backend-operations.ts`, `BACKEND_READ_TOOLS`, `exposure.config.ts` with
`NATIVE_READ`), with the schema fixture regenerated
(`scripts/generate_backend_tools_schema.py`).

| Operation | Arguments | Needs a scale |
|---|---|---|
| `sheet` | `document`, `page` | no |
| `figures` | `document`, `page`, `region`, `query`, `kind`, `limit` | no |
| `rooms` | `document`, `page`, `limit` | no |
| `scale_check` | `document`, `page`, `region` | no |
| `clearance` | `document`, `page`, `from`, `to`, `threshold_min`, `threshold_max` | yes |
| `distance` | the same | yes |
| `path` | `document`, `page`, `points`, thresholds | yes |
| `area` | `document`, `page`, `points`, thresholds | yes |

`from`, `to` and `points` are `[x, y]` shares of the page as shown, the frame
`look` returns. The description tells the agent to `look` first, lay a probe that
crosses both faces, and never to recompute, round or convert a returned number.

## Slices

Each is one pull request against `develop`, green on its own, behind the flag from
the first route on. The order is the order to build in.

### 1. `look` returns the text in its crop

* **Change:** `view_image.py`, `_render_pdf_region` and the whole-page path: under
  the same `pdfium_lock`, read the figures inside the widened box
  (`region_box_pt`) and append them to the result text, with the page's size in
  millimetres and its sheet format. Bounded: a cap on figures and characters, a
  note when cut. A scan returns none and says so.
* **Mind:** text from a licensed copy reaches the model only inside a licensed
  hit (`look/register.py`, ADR-0164): the appended text takes that path or is left
  out. It stays off the look card.
* **Done when:** the visual eval's dimension rows pass with the answer taken from
  the appended text; a rotated-figure fixture returns 185, not 581; the existing
  result-text tests are updated (`test_view_image_region.py`,
  `tools/look/test_register.py`, `test_question.py`, `test_place.py`); the answer
  suite ran before and after (`task be:eval:answer-suite -- --set visual`), report
  in the pull request.
* **Also:** a vector variant of the fixture renderer
  (`scripts/turn_census/render_fixture_drawings.py` writes rasters only), because
  a raster fixture has no text layer to read.

### 2. The engine and the reading operations

* **Change:** the engine modules; `drawing_measure` with `sheet`, `figures`,
  `rooms`, `scale_check`; the kind binding; the door operation; the records.
* **Fixtures:** synthetic vector sheets drawn in the tests (matplotlib writes a
  vector PDF with `pdf.fonttype = 42`, as `dxf_pdf.py` does): a room row with
  dimension chains at a known scale; the same sheet re-plotted smaller; a sheet
  with two regions at two scales and stored viewports; pages rotated 90°, 180° and
  270°; rotated and mirrored figures.
* **Done when:** every figure of every fixture reads back exactly; stored regions
  decode on all four rotations; `scale_check` reports agreement on the honest
  sheet and a contradiction on the re-plotted one; the classification tests know
  the tool (`test_chat_tools_are_classified.py`,
  `test_collection_read_inventory.py`, `test_register_decisions.py`); the prefix
  ceilings hold (`test_static_prefix_size.py`); the door fixtures are regenerated.

### 3. Measuring on a scale the file stores

* **Change:** `clearance`, `distance`, `path`, `area`, the tolerance, the
  threshold verdict, refusal without a scale and across two regions.
* **Done when:** on the fixtures a probe across an undimensioned span returns the
  drawn value inside its stated interval; the three verdicts are each produced by
  a fixture; an `uncalibrated` sheet yields no number; a type test refuses an
  answer without provenance; a property test holds that a returned interval
  always contains the drawn value across random probes on the fixtures.

### 4. A person's calibration

* **Change:** migration and table `drawing_calibrations` (organization, document,
  version, page, region as shares, `metres_per_point`, the two reference points and
  their true length when set by two points, who and when, `superseded_at`), under
  `grid_secure_table`, CHECKs for shares in the page and a positive scale, read
  through a `DocumentReader` with `documentVisibleTo` as every table of document
  facts is; service and repository; routes to list, set and withdraw; catalog
  operations and exposure; an internal read for the tool. In the review view: a
  `calibrate` tool beside select, point, region and ask
  (`use-document-review.ts`, `document-review.tsx`, `review-page-layer.tsx`), two
  points and a length field, the resulting ratio shown before saving; the scale
  state on the file (`file-list-view.tsx`, `page-readings.tsx`).
* **Done when:** `task db:test:rls` is green with the new table and its block in
  `scripts/rls-test-db.sh`; a calibration set in the review view makes the tool
  answer `vector_verified` on that region; the person's value replaces an earlier
  one and both stay readable; a `/dev/` preview exists and its captures are on the
  pull request; `surface-parity` has its entry.

### 5. The card that asks a person to confirm a scale

* **Change:** a fifth proposal kind, `drawing_scale`: `types.ts` (kind, payload,
  notice variant, view, and `applyProposalRequestSchema` gaining the value a
  decider may set), `kinds.ts` (every switch), an applier that writes the
  calibration row, the migration widening `proposed_changes_kind_known`, the wire
  schema fixture, `proposal-decisions.ts` (`describePayload` returns `null` for a
  kind it does not know, which would hide the decision from the agent), the inbox
  copy, the Python client's `ProposalKind`, the card model and its generated
  schema, the receipt body with the crop (`PageRegionThumbnail`), an input atom for
  the changed value, and the MCP Apps card (`proposal-cards.tsx`, which draws an
  unknown kind as not drawn).
* **Mind:** no proposal card has an input today. The one precedent for a decider
  changing what is applied is a second button (`memoryScope`), not a field.
* **Done when:** the agent's answer on an `estimated` region carries the card; a
  person can confirm, change the value, or dismiss, and the calibration row holds
  what the person chose with the proposal kept; the next turn's
  `PROPOSAL_DECISIONS` block states the decision; `docs/architecture/proposed-changes.md`
  is corrected (its migration numbers for the `operation` kind are wrong: the kind
  CHECK is in 0175).

### 6. Proof and counting

* **Change:** the round trip (a storey of an IFC fixture drawn as a vector sheet,
  measured, compared with the model: `ifc_spatial` draws SVG through
  `tools_analysis.draw`); eval rows with ground truth for a printed figure, a
  room-stamp sum, an undimensioned span, a refusal, a contradiction and an
  undecidable verdict; a Langfuse score for the release gate; product events for a
  calibration set and a proposal changed (`captureServer`, `ServerEvent`,
  `docs/observability/posthog-events.md`).
* **Release gate:** on the eval set, no answer states a number whose true value
  lies outside its stated interval.
* **Done when:** the tolerance constants of decision 8 are replaced by the measured
  ones, or confirmed.

### 7. A measurement kept on the sheet, and the person's tape

* **Change:** annotation shapes `line`, `path` and `polygon` with a points array
  (migration, `types.ts`, `placeProblem`, `marks.py`, the carry to a new Fassung,
  the exports); distance, path and area tools in the review view, snapping to the
  linework through a route that serves the engine's snap points for a page region.
* **Done when:** a measurement made by a person or the agent stays on the sheet,
  is named and commented like any annotation, and shows its value and interval.

### Not in this build

Computing a scale for a sheet that stores none; sheet facts at ingestion; layer
switching in the viewer; general DXF operations and one merged tool; DWG; the room
at a point; counting by example; area rules by standard; straightening a scan.

## What every pull request owes

* A Conventional Commits title; the closing checklist of
  [`definition-of-done.md`](../contributing/definition-of-done.md), every line
  filled.
* `task verify:fast` green, and `task lint:repo`. `task db:test:rls` for slices 4
  and 5. `task pkg:test` when `packages/` is touched.
* The answer suite before and after for slices 1 to 3 and 5, report in the pull
  request.
* A release note (`task release:note -- <slug>`, then `task release:lint`) from the
  first slice a customer could notice with the flag on; before that, the
  `no-release-note` label with the reason.
* A `/dev/` preview and captures for every surface (`docs/ux/visual-screenshots.md`).
* Every route a person calls has its operation and its exposure entry; every list
  operation takes `limit` and `cursor`.
* Docs in the same change: `agent-tool-surface.md`, `agent-surface.md`,
  `where-is-what.md`, an ADR for the calibration record and the tool (one each, the
  next free numbers from `scripts/check_adrs.py --next`), and what was learned.

## What needs the product owner

* Creating the `drawing-measure` flag in both WorkOS environments.
* Running a migration against a database the builder did not create.
* Plan files from the pilot offices: the sample behind this spec is fourteen
  files, two of them Archicad plots.
* Ticket 33 says the scale is per page. This spec builds per region.

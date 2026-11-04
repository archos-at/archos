---
status: accepted
date: 2026-11-04
decision-makers: Grid engineering, product owner
consulted:
informed: everyone working in this repo
---

# A DXF drawing is a site the agent measures, through one native tool and the agent door

## Context and Problem Statement

ADR-0152 made a DXF readable: its PDF rendition carries the labels and, for a
BEV Katastralmappe, a page listing every parcel with its area and neighbours,
and the index reads both. That answers "how large is 123/4?". It does not answer
what an architect asks next about a Katasterauszug: how far the house stands
from the boundary with 123/5, how long that boundary is, what is left to build
on after 3 m on every side and 4 m towards the neighbour, what a coverage of
40 % allows. Those need the drawing's geometry, and a page of text has none. An
agent that reads the PDF and computes a distance from it is guessing.

The office that asked for DXF support (support ticket, 2026-11-02) converted the
extract to PDF only so the agent could read it. The question is what lets the
agent measure it.

## Decision Drivers

* The numbers come from the **same model the rendition draws** (`agent.drawings`):
  the page a person sees and the figure the agent quotes cannot disagree.
* Every answer says **how far it can be trusted**: a Grundsteuerkataster boundary
  is graphic and not legally binding (BEV spec v2.6, p. 12), and a drawing with
  no unit has no metres. A question the file cannot answer is undecidable, with
  the remedy, never a guess.
* **Setbacks and limits are the caller's.** The drawing holds none; they come
  from the Bebauungsplan or the building code, which the agent looks up.
* The document is resolved and its bytes read **under the turn's scope**, the
  way `look` reads a page: a restricted folder's drawing only when the whole
  audience may read it, and the read reported so the turn admits it (ADR-0088).
* Outside agents get it too, on the agent door (ADR-0122), with the description
  and schema the chat model reads.

## Considered Options

1. **A native read tool, `dxf_measure`**, over the site model in
   `packages/agent/src/agent/drawings`, served on the door as `dxf-measure`
   through `BACKEND_READ_TOOLS`, as `ifc_measure` is.
2. **An existing CAD MCP server** (the AutoCAD and LibreCAD MCP servers on the
   public registries).
3. **ifc-lite's DXF import and MCP server.**
4. **Only the rendition**: let the agent read the parcel list and `look` at the page.

## Decision Outcome

Chosen option 1. `dxf_measure` (`tools/drawings/register.py`) takes one
`operation`: `overview`, `parcels`, `parcel` (area, perimeter, enclosing
rectangle, boundary length per neighbour and to the edge of the extract, the
buildings on it), `setbacks` (each building's shortest distance to each
neighbour's boundary), `buildable` (the parcel minus a band per side, then the
coverage and floor-area-ratio allowances), `distance` (between parcels or
`building N`), `texts` and `layers` (for any DXF). The site is built once per
file version and kept in a bounded per-process cache keyed by the version's
object key; every call still goes through the BFF's scoped lookup
(`GET /api/internal/document-file`) first, so the cache is never a way in
(`tools/drawings/source.py`).

Its answers reach the answer check (ADR-0139) as records, like a workspace read
(`common/workspace_records.drawing_record`), never through the
`SourceRegistry`: a computed distance is not a passage a `[N]` resolves to. Not
project-only: a DXF attached to a chat outside a project is measured too.

Rejected:

* **Option 2** because the CAD MCP servers found (November 2026) drive a
  running AutoCAD or LibreCAD to draw: write and execute surfaces, a desktop
  licence, and no notion of a parcel. Re-check if one appears that reads a DXF
  headless and answers about parcels.
* **Option 3** because ifc-lite's DXF import is a viewer underlay and its MCP
  server answers about IFC models only (checked November 2026). Re-check if it
  gains DXF queries.
* **Option 4** because a page of text carries no geometry: a setback read off a
  picture is a guess, the failure ADR-0045 exists to prevent for IFC.

### Consequences

* Good, because the question the office converted a file for is answered from
  the file: area, neighbours, setbacks and what remains buildable, each with its
  accuracy note.
* Good, because rendition and measurement share one reader: the module moved from
  `apps/agent-host` into `packages/agent/src/agent/drawings`, and the backend's
  renderer imports it (the agent may not import `agent_host`).
* Bad, because `agent` now depends on ezdxf and shapely. Its own entry point
  (`drawings`) keeps every other tool alive where they are missing.
* Bad, because a building is a closed outline on `HG`/`HL` (cadastre) or on the
  layers the caller names. A drawing whose houses are open line work has no
  buildings; the answer says so.
* Bad, because the first call on a whole cadastral community parses it for
  seconds (ADR-0152 measured 8 to 46 s for 1,600 to 10,000 parcels); later calls
  on the same version are served from the cache, four sites per process.
* Bad, because the tool is bound on every chat turn, about 1,160 tokens of
  schema and description (o200k, measured 2026-11-04), whether or not the turn
  has a DXF. Binding it only when the inventory holds one would split the
  prompt cache per project; re-check if that cost shows in the turns audit.
* Bad, because the door's tools-mode budget rose from 1,050 to 1,060
  characters a tool on average (`mcp-server.spec.ts`): the tool is about 3,000
  characters, its eight operations and the `buildable` arguments.

### Confirmation

* `packages/agent/tests/drawings/test_site.py` checks every figure against the
  fixture's coordinates by hand: parcel area and boundaries, the house's 5, 8
  and 4 m to its boundaries, 442 m² buildable inside 3 m and 4 m bands, the
  coverage and density allowances, distances, labels, layer sums, a millimetre
  drawing converted, and a unitless one refused.
* `packages/agent/tests/tools/drawings/test_dxf_measure.py` pins that the lookup
  echoes the turn's envelope, that a read reports its collection and a refused
  one reads no bytes, that the cache never skips the lookup, and that an answer
  is a record the answer check reads while a refusal is none.
* `packages/agent/tests/knowledge/test_collection_read_inventory.py` and
  `test_chat_tools_are_classified.py` classify the tool; `test_exposure_config.py`
  and `backend-operations.spec.ts` hold the door entry to the chat agent's tools.

## More Information

* ADR-0152 (the rendition and the parcels it lists), ADR-0045 (the IFC model as
  a queryable building, whose `distance_to_site_boundary` needs exactly this
  boundary), ADR-0122 (the agent door), ADR-0088 (restricted folders), ADR-0139
  (the answer check).
* BEV, *Katastralmappe DXF, Schnittstellenbeschreibung* v2.6 (16.12.2024).

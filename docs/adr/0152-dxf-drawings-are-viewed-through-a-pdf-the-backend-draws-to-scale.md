---
status: accepted
date: 2026-11-04
decision-makers: Grid engineering, product owner
consulted:
informed: everyone working in this repo
---

# DXF drawings are viewed through a PDF the backend draws to scale with ezdxf

## Context and Problem Statement

An office in Vienna had a cadastral extract (Katasterauszug) as a DXF, could not
put it into the product, and converted it to PDF with an online tool instead
(support ticket, 2026-11-02). Upload did not accept `.dxf`, and nothing rendered
CAD files: pilot-feedback backlog PF-11 had DWG, DXF, IFC and TIFF open after
ADR-0070 closed the Office half, and ledger item 38 asked for this ADR.

What a person does with a cadastral extract is print it to scale, attach it, and
read parcel numbers and areas off it. A "fit to page" PDF, which is what an
online converter hands out, cannot be measured. And the file says more than it
shows: BEV's Katastralmappe DXF (Schnittstellenbeschreibung v2.6, 16.12.2024)
carries its coordinate system in the sheet marker, marks every parcel number as
Grenzkataster or Grundsteuerkataster, and in its "BEV-DXF+CSV" variant is a
partial R12 file with no block definitions at all (§1, §2, §3.1, §3.3).

## Decision Drivers

* The page must be **to scale**, at a standard scale on a standard sheet, and
  say so; a drawing that names no unit must say it is not to scale.
* The parcel numbers and labels must be **text** a viewer can find, the index can
  read and a citation can highlight; a drawn outline is none of those.
* The original is the record (ADR-0070): what is shown is derived and never
  replaces it.
* Buy, don't build: DXF parsing and drawing is somebody else's domain. Open
  source, and no copyleft that reaches a hosted service.
* Reuse ADR-0070's machinery: sibling key `_render.pdf`, lazy at view, eager at
  ingest, the viewer, the thumbnail and ADR-0071's index-from-rendition.

## Considered Options

1. **ezdxf + matplotlib in the Python backend**, called by the BFF where it
   calls Gotenberg.
2. **Gotenberg's LibreOffice route**, which accepts `.dxf` through Draw's import
   filter.
3. **ezdxf's own PDF backend**, on PyMuPDF.
4. **A browser viewer** (`dxf-viewer`, MPL-2.0, WebGL through three.js).
5. **The ODA File Converter** or another proprietary CAD SDK.

## Decision Outcome

Chosen option 1: **ezdxf (MIT) reads and draws the file, matplotlib writes a
vector PDF, in a route of the backend (`POST /v1/renditions/dxf`), and the BFF
stores the result as the rendition.** The BFF still decides what is converted
and owns the object; it only calls a second converter (`rendition.ts`,
`converterFor`).

What the page carries, beyond the drawing:

* **A standard scale on a standard sheet.** The most detailed of 1:1 … 1:25000
  that fits, on A4 or A3 up to 1:2000 first, then A2 to A0 (`sheet.py`). A
  150 × 100 m extract lands on A3 at 1:500. The unit comes from `$INSUNITS`; a
  Katastralmappe is metres by its spec. No unit: fitted, labelled "Nicht
  maßstäblich".
* **A transparent text layer** of every TEXT, MTEXT and visible ATTRIB at its
  own place and height, as an OCR layer is.
* **A title block and a scale bar**, and for a Katastralmappe the cadastral
  community, MGI / GK M28/M31/M34 (EPSG 31254/5/6), grid north, and, where it
  holds Grundsteuerkataster parcels, that their boundaries are graphic and not
  legally binding.
* **"Als PDF herunterladen"**: `GET /api/documents/[id]/download?format=pdf`
  hands out the rendition, for office files as well, and the agent operation
  `document-download` takes the same query.

Rejected:

* **Option 2** because Gotenberg's LibreOffice route takes page properties for
  office documents and no drawing scale, so the page would be fitted, not to
  scale, and nothing could write a text layer or a title block into it. Whether
  LibreOffice keeps a partial BEV file's parcel numbers was NOT measured. Re-check
  if Gotenberg's route gains a way to place a drawing at a scale.
* **Option 3** because PyMuPDF is AGPL-3.0 (or commercial), which reaches a
  hosted service. Re-check if PyMuPDF's licence changes.
* **Option 4** because it is a second viewer next to the PDF one, with no
  thumbnail, no index and no citation highlight, and a PDF zooms crisply
  already. Worth adding only if people ask for layer toggles.
* **Option 5** because its licence does not allow a hosted service without a
  paid membership, and DXF needs no proprietary reader.

### Consequences

* Good, because the customer's task (a DXF to a printable PDF) is one click, and
  the PDF is to scale, which the online tool was not.
* Good, because everything ADR-0070 and ADR-0071 built works unchanged: viewer,
  thumbnail, ingest from the rendition, citation pages, retries.
* Good, because a DXF never needs Gotenberg: a deployment without it still
  shows drawings.
* Bad, because the BEV symbol library is not shipped: boundary-point marks and
  land-use symbols in a partial BEV file draw as nothing, while their attribute
  text (the parcel numbers) draws. Shipping the block definitions is the next
  slice.
* Bad, because only the model space is drawn. A DXF whose sheets live in
  paper-space layouts is drawn as its model, not as its plotted sheets.
* Bad, because DWG is still not shown. LibreDWG (GPL-3.0, run as a separate
  `dwg2dxf` process, which keeps it out of our code's licence) is the open
  candidate and needs its own check of fidelity and image size.
* Bad, because one page is drawn at a time per backend process (matplotlib's
  state is global); a folder of hundreds of DXF files converts serially.

### Confirmation

* `apps/agent-host/tests/test_drawing_renditions.py` measures the scale on the
  PDF (35 m between two parcel numbers is 175 mm at 1:200), and fails if a
  header-less BEV file loses a parcel number, if the text layer loses an umlaut,
  or if a unitless drawing claims a scale.
* `apps/workspace/bff/documents/rendition.spec.ts` pins that a DXF goes to the
  backend with the internal token and never needs Gotenberg;
  `preview-types.spec.ts` that a DXF is a rendition source, never inline, and is
  stored as `application/dxf` whatever the browser said.
* `tests/knowledge_layer_tests/test_rendition_extensions_parity.py` keeps the
  BFF's and the backend's index-from-rendition lists equal.

## More Information

* BEV, *Katastralmappe DXF, Schnittstellenbeschreibung* v2.6 (16.12.2024):
  partial files §1, coordinate systems §2, sheet marker §3.1, parcel numbers
  §3.3, "graphisch ermittelt" p. 12.
* ADR-0070 (office renditions), ADR-0071 (indexing from them), ADR-0045 (IFC:
  `distance_to_site_boundary` asks for exactly the boundary a cadastral DXF
  holds; reading parcels as polygons is the slice after this one).

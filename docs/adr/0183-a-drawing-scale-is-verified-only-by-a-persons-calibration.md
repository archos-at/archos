---
status: proposed
date: 2026-11-11
decision-makers: Matthias Bigl
consulted:
informed:
---

# A drawing's scale is verified only by a person's calibration, kept as what the person did

## Context and Problem Statement

`drawing_measure` (ADR-0182) states a length where a scale hint is corroborated
by the sheet's own dimension figures, and calls that `estimated`. It decides no
threshold from an estimate. Something has to turn a region `verified`, and it
has to be a person: a file can store a wrong scale, and a sheet can print one.

What is the record of that act, who may write it, and what does the agent read?

## Decision Drivers

* A wrong number stated with confidence is the failure. A record that can make
  a number `verified` must not be writable by a model alone, and must not carry
  a value a client computed.
* A calibration is true of the bytes a person looked at. A new version of the
  document is other bytes.
* One sheet holds views at different scales.

## Considered Options

* Store the scale (metres per point) the client computed.
* Store what the person did, and compute the scale where the file is read.
* Keep the calibration on the document, across versions.

## Decision Outcome

Chosen: **store what the person did, per version, per region**.

* **The row is the act.** Table `drawing_calibrations` (migration 0236): the
  document, its version, the page, a region, two reference points and the true
  length between them in metres. Places are shares of the page as shown, origin
  top left, as an annotation's are. There is no scale column. The agent
  computes metres per point from the sheet it read itself
  (`agent/drawings/sheet_calibration.py`), and the review view from the page it
  shows. A page size a client claims is never part of a number.
* **A region, never the page by default.** The region is required, both points
  lie inside it, and CHECK constraints say so. Outside the region the sheet
  stays as it was.
* **One version.** `version_id` is not null. A new version starts with no
  calibration, and a document without a version row cannot be calibrated.
* **Three states** (`defineLifecycle`, ADR-0179): `active`, `superseded`,
  `withdrawn`. Setting a region again supersedes its active row in one
  transaction; a partial unique index allows one active row per region.
  Withdrawing does not revive what was superseded.
* **No new permission.** Listing needs read access to the document; setting
  and withdrawing need `project:documents:write`. Row-level security is the
  organization's; every read also ANDs `documentVisibleTo(reader)`.
* **The agent reads it with the file.** `GET /api/internal/document-file` takes
  `calibrationsPage` and answers the active calibrations of that version and
  page, at most 50, under the same scope check as the file's key. The agent
  does not cache them: one withdrawn a moment ago is gone from the next call.
* **A calibration can be contradicted.** Where another calibration, the stored
  region, or the sheet's own figures disagree with it beyond their errors, the
  reading says so and every verdict in the region is `undecidable`
  (`sheet_scale._contradiction`). A person has to look.
* **Behind `drawing-measure`**, as the tool is. The three operations are
  catalogued, `external: false`, and offered to the in-product agent, whose
  set or withdraw is a proposal a person accepts. Each route refuses without
  the entitlement (403 `feature_disabled`). An operation now names the feature
  its route needs (`AgentOperation.feature`), and `proposeOperation` files no
  proposal for an organization without it: such a card could only fail when
  accepted.

* **The agent may ask, never set.** On a corroborated estimate in a region the
  file itself stores, the measuring tool names one call that proposes a calibration: the longest agreeing
  dimension figure of the region, its two ends and its printed value
  (`agent/drawings/sheet_proposal.py`). The call goes through the existing
  `operation` proposal kind, so a person sees the crop with the reference span
  and accepts or dismisses; the route then writes the row as that person. No
  fifth proposal kind. Where the figures do not corroborate the hint nothing is
  proposed: the region is calibrated by hand.

### Consequences

* Good, because nothing a model or a client computes can make a number
  `verified`: the engine recomputes the scale from the two points and the
  length on the sheet it read.
* Good, because the record survives a change of how the page is rendered or
  measured: shares of the page and a length in metres mean the same later.
* Bad, because a calibration does not carry over to the next version. A person
  calibrates again; carrying one over where the region's linework is unchanged
  is a later decision.
* Bad, because a calibration within 0.5 % of the truth, where no stored region
  says otherwise, is not detected as wrong. The figure check cannot see finer.

### Confirmation

`task db:test:rls` with the table's block and
`bff/drawing-calibrations/repository.integration.spec.ts` as the runtime role;
`packages/agent/tests/drawings/test_sheet_calibration.py` for the record;
`packages/agent/tests/tools/drawings/test_drawing_measure.py` for a region
turned `verified`, the place outside it left as it was, a contradiction
reported, and no caching.

## More Information

* ADR-0182 (the reader and the tool), ADR-0179 (lifecycles), ADR-0041 (RLS).
* `docs/roadmap/drawing-measurement-build-spec.md`, decision 7 and slice 4.

---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §3.4 and §3.6) and its build split (S11)
informed: the slices that read editions in time (S8 Austria, S15 turn context, S16 Germany)
---

# The law of a procedure is the edition its node's reference-date rule and the amending editions' transitions name

## Context and Problem Statement

An architect is judged by the law in force when the submission was filed, not
today's (ticket 30). The base knowledge records (ADR-0163, ADR-0165) held each
edition's in-force dates, and rulesets (ADR-0166) named `reference_date` as a
purpose, but nothing chose an edition for a procedure. An answer about a
submission filed in 2022 could only quote today's law, or the oldest edition the
platform happened to hold. Neither said so.

Three things decide the edition, and each varies by jurisdiction:

- the reference date (Stichtag): filing in most Austrian Länder, but each node
  picks its own, and BauGB and BayBO pick separately for one Munich permit;
- transitional provisions (Übergangsbestimmungen) on an amending act, which
  can keep the old law for a procedure filed before the boundary and open at it
  (the shape of NÖ BO § 70);
- how far back the platform holds a work's history.

## Decision Drivers

- Fail closed: an unknown date is asked for, never taken as today; a day before
  the history held is `history_not_held`, never the oldest edition present; two
  editions in force on one day are a data error.
- One evaluator: reference dates and transitions are decision tables on
  ADR-0166's evaluator, so "ask only what can change it" is the evaluator's
  `unknownInputs`, not a second implementation.
- One store: editions, transitions and reference-date rules are platform records
  (ADR-0165), released through reviewed change requests, not a parallel table.
- Flag off is today's behaviour. (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)

## Considered Options

1. Take the edition in force on the filing day, in code, for every node.
2. Rules per node as rulesets, transitions as decision tables on the amending
   edition, and a boundary walk that combines them (design §3.6).
3. Hold a full temporal model of every consolidated version per paragraph
   (RIS's own shape) and query it by date.

## Decision Outcome

Chosen option 2.

- **Procedure.** `{procedureType, filedOn, decidedOn | 'pending', worksStartedOn
  | 'not_started'}` (`bff/base-knowledge/wire/time.ts`). `null` is unknown;
  `'pending'` is a known fact. On a project it is profile facts scoped to the
  procedure, `filed_on@p1`, `decided_on@p1`, written through
  `project-profile-patch` like any fact (`time/profile-procedure.ts`).
- **Reference date.** The legislating node's `reference_date` ruleset (output
  type `event`) names a procedure event or a dated fact
  (`governing_plan_adopted_on` for a work-targeted rule), selected with
  `decide()` on the filing day, the node first, `explicit` inheritance
  (`time/as-of.ts`, `referenceDateOf`). Without a filing day there is no rule to
  pick, so the answer asks for `filed_on`. Without a rule the answer is
  `no_reference_date_rule` with the edition each known event gives.
- **Edition on a day.** An edition is in force on `[in_force_from,
  in_force_to)`: `in_force_to` is the first day it no longer holds, the
  successor's `in_force_from` (amended 2026-11-10, migration 0217; until then
  it was the last day, the reading RIS prints, while relations, territories
  and rulesets were already half-open, and the chain resolver dropped a law on
  its edition's last day). A source that prints the last day in force (RIS's
  Außerkrafttretensdatum, verified on the OGD API: the Bauproduktegesetz 1997
  ends `2018-12-31`) is entered and read one day later. `time/editions.ts`
  `editionInForce` is the rule for law: the time path and the chain resolver
  (`chain/resolve.ts`, through `editionFor`) both ask it. A norm, a guideline
  or a commentary has no in-force date of its own and a new Ausgabe replaces
  the old one without an end date, so its edition at a date is the newest
  issued and not withdrawn (`newestInForce`). An office's own law edition,
  entered with its issue date only, counts from that date. An undated law
  edition beside dated ones is left out. A law whose edition stays unknown
  binds nothing and is named: `undetermined` in the knowledge context, a
  "Not determined here" line in the chain text, `undetermined_editions` in
  the trace metadata. KC-3 refuses an edition that ends the day before its
  successor begins, the trace of a copied last day. Undated editions
  make the work `edition_dates_unknown`; overlap is `ambiguous_editions`; before
  `history_available_from` (or before the oldest edition when that is null) is
  `history_not_held` (`time/editions.ts`). KC-3 refuses two editions of one
  work in force on one day in one proposal.
- **Transitions.** `knowledge_edition_revisions.transition` (migration 0206), a
  `decision_table.v1` whose output is `old_law`, `new_law` or `choice`, reading
  the procedure facts and `boundary_from`. KC-5 runs its examples on submit.
- **The walk.** From the edition in force on the earlier of filing and the
  reference date, every boundary up to the decision (today in the node's zone
  while `pending`; no end when unknown) is crossed by its transition, or, without
  one, when the reference date lies on or after it. Without transitions this is
  the edition in force on the reference date. `choice` returns both editions; an
  unknown input returns the facts that can change it.
- **Today.** Only an open procedure reads today, in the zone of the node's
  country (`time/today.ts`); a country with no zone listed is `zone_unknown`.
- **Door.** `base-knowledge-edition-as-of` (`GET /api/base-knowledge/editions/as-of`):
  by `asOf`, by `projectId` and `procedureId`, or by a procedure given in the
  query. It names the edition by id and label, the reference date with its rule
  and provision, and each boundary walked. A read that is truncated or holds a
  record the schema cannot read is `records_unreadable`.
- **law-lookup.** `as_of` reads only RIS version documents whose own window
  covers the day; the federal search asks RIS for that day
  (`Fassung.FassungVom`), the whole-law document and the catalog pointer
  (today's consolidation) are never read for a past day, and nothing found is a
  miss that says today's text was not substituted
  (`packages/ris-adapter/src/lookup/as_of.py`).
- **Flag.** `time-editions`, an entitlement. Off: the route answers 403 and
  `law-lookup` refuses `as_of` (the agent tier reads it as
  `features.timeEditions` from `GET /api/internal/stages`). (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)

### Rejected options and the premise each rests on

- **Option 1** rests on every node taking the filing day and no amendment
  carrying a transition. BauNVO takes the plan's adoption, and NÖ BO § 70 keeps
  the old law for an open procedure; a coded default is a wrong date, not a
  missing one.
- **Option 3** rests on holding every paragraph's version history. The platform
  holds editions of works (ELI's point-in-time versions), and RIS holds the
  paragraph versions. `law-lookup` reads those at the source rather than
  copying them.

### Consequences

- Good: "what applied when this was submitted" is answered with the edition
  named, or with exactly what is missing, on a fixed as-of set
  (`time/as-of-set.fixture.ts`, 15 cases) through the real evaluator.
- Good: a Land adds its Stichtag and transitions as records through a change
  request; no code.
- Bad: edition minting on first citation (design §3.4) is not built. An edition
  the platform does not hold is `history_not_held`, and a reviewer proposes it.
  Minting from RIS needs RIS's version metadata in the sandboxed fetcher and a
  change request opened by the source monitor (S16).
- Bad: Land law in RIS has no verified date parameter (`configs/sources/at/ris/source.yml`,
  "[verify the OGD API]"), so a Land `as_of` lookup may find only today's
  versions and miss. That is the fail-closed answer, and it is what verifying
  the parameter would change.
- Bad: `knowledge-search` takes no `asOf` yet. Platform corpus points carry no
  edition until S8's payload (`edition_id`), so a filter could only drop the
  platform corpus or claim a check it did not make.
- Neutral: `law-lookup`'s tool schema gains the optional `as_of` for every
  organization; with the flag off a call that uses it is refused, and a call
  without it runs as before.

### Confirmation

`time/as-of.spec.ts`: the fixed as-of set, a positive control, revert checks
(remove the transition, the rule, the rule's validity and the answer moves), and
the fail-closed cases. `time/time.integration.spec.ts` (in `task db:test:rls`):
the same answer from records released through a change request, and nothing for
an office not entitled. `time/service.spec.ts`: the flag, the three ways to ask.
`platform/validate.spec.ts`: KC-3 overlap and KC-5 examples.
`packages/ris-adapter/tests/test_ris_lookup_as_of.py`: the version of the day,
the miss, the refusal with the flag off.

## More Information

Design `docs/design/international/design.md` §3.4 and §3.6, build split S11
(branch `claude/intl-design`). ELI (European Legislation Identifier) for
point-in-time versions; RIS OGD API v2.6, `Fassung.FassungVom`.

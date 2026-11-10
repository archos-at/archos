---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §3.7, §5.3 to §5.5, E34) and its build split (S9)
informed: the slices that read setup records next (S8 Austria as pack 1, S15 turn context, ticket 31's intake agent)
---

# Setup facts are country records: what a project's setup asks, derives and requests comes from its site's records

## Context and Problem Statement

What a project's setup knows per country was the last country code in the
workspace (design §2.1, review finding): the Bundesländer were options in
`intake-stages/project-basis.ts`, the Gebäudeklasse was `derivations.ts`, the
documents a site needs were `LOCATION_REGISTER` in `location-register.ts`, and
each was gated by a hard-coded `siteCountry(profile) === 'at'`. The BIM rules
judged OIB-Richtlinien for any project's model, wherever it stood (live
defect 5). A German or Swiss office would get Austria's options or nothing, and
adding a country meant a code change in four modules. Setup is also becoming
agentic (ticket 31): an intake agent needs each fact and lookup as data and an
operation, not as a questionnaire.

## Decision Drivers

- A country is data, not code: the same records, the same evaluator, the same
  walk up the territory chain (ADR-0166).
- Zero diffs for Austria: every Austrian profile and fixture reads as before.
- Fail closed: no country, or a country without a record, gets no
  country-specific option, class or request; unknown is never Austria.
- One door: a class before and after is a catalog operation, not prose.

## Considered Options

1. **Setup records as ruleset bodies, selected by the site** (chosen).
2. A per-country TypeScript module behind an interface.
3. A setup questionnaire per country, stored as one JSON document.

## Decision Outcome

Chosen: option 1. Two payload schemas join the decision table as ruleset
bodies (migration 0207 widens the `payload_schema` CHECK and pairs each with
its purpose):

- `fact_definitions.v1`: the facts a country's setup knows, with type, unit,
  allowed codes and the key the Bestand holds them under (`existingKey`); the
  subdivisions a site is placed in, with their territory ids; the derivations,
  each with its Fundstelle and what each table code means (class number,
  high-rise, no building).
- `fact_sources.v1`: per request, the facts it settles, the document, the
  reason, the law, when it applies, and what differs per subdivision or
  municipality.

`project-intake/setup-scope.ts` turns a profile into its chain (`AT-9`, `AT`)
and selects every record on it with `selectRecord` / `selectRuleset`. The
derivation, the decisive needs, the location register, the wizard's
Bundesland options and the BIM rules all read through it. A classification
reaches a profile only when both its table and its derivation definition exist
for the chain. The BIM catalogue names the territory each rule binds in: an
OIB rule outside Austria is not applicable with the reason, and for a project
nothing places every element is undecidable with the site on the shopping
list (never „nicht einschlägig", which would drop it from open work). A
compliance diff judges both revisions at the site of the model whose project
asks, so a site difference never reads as a model change. A change of site
re-derives the classes only when it selects another classification.

`classification-evaluate` (`POST /api/projects/[id]/classification-evaluations`)
runs the classification on the planned values and, for a Bestand, on today's,
and answers the shift, the open inputs, the classes still possible, and the
document each open input needs (E34).
Amended by ADR-0175: where the project's knowledge context withholds law (not
entitled, unreadable, no coverage, no site), it names no class and answers
`undetermined` with that gate, as the turn would.

**Where the records live today.** Austria's three records ship as seeds
(`bff/base-knowledge/rulesets/seeds/`, listed in `rulesets/shipped.ts`) and are
parsed by the same wire at boot. Migration 0207 makes them storable, but the
setup does not read the database yet: an office's or the platform's ruleset in
force at `AT` would make two records for one node, which the selection refuses
as ambiguous. Moving Austria into published platform records with the
precedence merge is S8's.

### Rejected options and the premise each rests on

- **A TypeScript module per country** rests on countries being few and
  changing with deploys. Neither holds: the platform publishes country data
  through reviewed change requests (ADR-0165), and every module would repeat the
  missing-input logic the evaluator already has.
- **One questionnaire document per country** rests on setup being a form. It
  is becoming lookups an agent runs (design §5.3), and a monolith cannot be
  selected per subdivision or versioned per rule.

### Consequences

- Good: Austria's setup is byte-identical (the parity harness below), and a
  German or Swiss project gets its own country's subdivisions, class and
  requests the day its records exist, with no code.
- Good: the derivation's missing inputs are the evaluator's, so the needs, the
  review and `classification-evaluate` name the same facts.
- Changed on purpose, outside Austria only: a project nothing places is
  requested no document (develop listed Austria's), a confirmed class input of
  a project with no classification is no longer kept on the needs list, and a
  profile saying `country=at` with the Land „außerhalb Österreichs" is read as
  in no named country by the derivation too, not only by the register. A BIM
  model in no project, or in an unplaced one, is no longer judged as Austrian.
- Bad: until S8, the setup reads shipped seeds, not the database; a record an
  office stores in a setup purpose is valid and kept but read by nothing.

### Confirmation

- `project-intake/setup-parity.spec.ts`: 400 generated profiles, read by
  develop's code into `tests/fixtures/setup-parity.json` (needs, derivations,
  register, the derived profile, as hashes) and by this tree; Austrian ones
  must match exactly, the others differ only as listed. It also pins the
  intake definition's serialisation to develop's.
- `base-knowledge/rulesets/building-class.spec.ts`: the product's derivation
  against the retired code (`derivations.oracle.ts`) on its cases and 3,000
  generated Buildings.
- `project-intake/setup-scope.spec.ts`, `location-register.spec.ts`,
  `classification.spec.ts`: synthetic German and Swiss records
  (`setup-countries.fixtures.ts`) show each project receives only its own.
- `bim/rules.spec.ts`: the site gate, with Austria as the positive control.

To regenerate the parity fixture after a deliberate change to what the
generator covers, run `setup-parity.fixtures.ts` on a worktree of the commit
before the change, never on the tree under test.

## More Information

Design `docs/design/international/design.md` on `claude/intl-design` (§3.7,
§5.3 to §5.5, E34); build split S9. ADR-0158 (the site decides the law),
ADR-0166 (rulesets and the evaluator), ADR-0165 (platform records).

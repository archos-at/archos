---
status: proposed
date: 2026-11-10
decision-makers: engineering, with the product owner's acceptance of Wave 5 ("the building-narrowed OIB list returns as data")
consulted: ADR-0166 (decision tables and the one evaluator), ADR-0168 (the chain), ADR-0169 (setup facts), ADR-0173 (the knowledge context), ADR-0175 (the cut-over)
informed: everyone who reads an answer or a Steckbrief about the law of a site, and operators who publish a country
---

# An edition states which buildings it applies to, and the chain runs that scope per building

## Context and Problem Statement

The chain (ADR-0168) decides which edition binds a site, by territory and by
the routes that make a model code or a standard binding there. It knows
nothing of the building. Austria's Länder make OIB-RL 2.1 (Betriebsbauten),
2.2 (garages) and 2.3 (escape level over 22 m) binding as a set. When the
cut-over (ADR-0175) removed `bff/oib`, which narrowed them in code, every
Austrian project named all three, a block of flats included. The answer and
the Steckbrief call a guideline binding on a building it is not written for.

Whether a text applies to a building is its scope, and the scope is law: each
guideline states it in its own scope clause, and a new edition can change it.
It belongs in the records, reviewed like any other claim, not in a TypeScript
copy of a Python list.

## Decision Drivers

- One answer, read from records: the turn, the Steckbrief, `project-base-get`
  and a research run name the same law for the same building.
- A rule over building facts runs only in the one evaluator (ADR-0166).
- No country and no work is named in code.
- Fail toward too much law, never too little: a scope that cannot be read
  narrows nothing.

## Considered Options

1. Keep naming every edition the routes reach, and let the agent judge scope
   from the text.
2. A scope on the edition: `appliesWhen`, a `decision_table.v1` with a boolean
   output over the building's facts, run by the chain per building.
3. A fifth ruleset purpose, `applicability`: a territorial ruleset that names
   the works it narrows.
4. A JsonLogic condition on the work (design §3.4 as first written).
5. Conditions on the `makes_binding` relation, so a route binds only when the
   building matches.

## Decision Outcome

Chosen option 2.

- Option 1 is rejected on the premise that the turn reads the chain's roles as
  given: an edition the chain names as binding is cited as binding (ADR-0168,
  `citations/roles.py`). If the agent ever weighed scope from the text before
  citing, the cost would be only a wrong chip on the page.
- Option 3 is rejected on the premise that rulesets are territorial (they are
  selected by the nearest node on the site's chain) while a scope belongs to
  one text and travels with it into every Land that routes it. A territorial
  record pointing at works also lets an edition change scope without its scope
  changing in the same revision. Were a Land to narrow a text by its own law,
  a territorial rule would be the right form for that difference.
- Option 4 is rejected on the premise that a new edition can change its
  scope, so the work is the wrong holder; and
  a bare JsonLogic expression has no rows, no provision per row and no
  examples, which the kit's KC-5 check and the Steckbrief's reason need.
- Option 5 is rejected on the premise that scope belongs to the text, not the
  route: nine Länder route OIB-RL 2.1, so the condition would be written nine
  times, each a place to drift.

What it is:

- **Record.** The edition record's `appliesWhen`: a `decision_table.v1`
  (ADR-0166) whose output is `boolean` (`wire/applies-when.ts`); null applies
  to every building, as before. Stored in
  `knowledge_edition_revisions.applies_when` (migration 0216, provisional
  number), which the SQL holds to an object; the wire refuses any other
  output. The kit runs the table's own examples (KC-5, pointer `/appliesWhen`).
  Each row's `provision` cites the edition's own scope clause.
- **Evaluation** (`rulesets/applicability.ts`, `applicabilityOf`). The table
  runs once per building on the building's facts, read through the country's
  `fact_definitions` (the intake's own readers, `chain/building.ts`). True is
  `applies`, false is `not_applicable`, undetermined is `check`. The project
  gets the strongest verdict any building gives: one production hall makes the
  project need OIB-RL 2.1. An open fact reads `check` and names the facts that
  would decide it. A project with no building described yet is one building
  with every fact open. A table the evaluator cannot run reads `check`.
- **Chain.** `resolveChain` takes the building scope. An edition no building
  needs is dropped. Each other scoped use carries `applicability` (`verdict`;
  `basis`, the facts the deciding row read; `open`; `provision`), and an
  unscoped one carries null. The knowledge context resolves through it, so the
  turn, the page and a research run agree. The chain text tells the agent when
  scope waits for a fact, to ask for it, and not to say the edition binds or
  does not bind before then. The buildings join the context's digest, so a
  changed use re-resolves.
- **Fail toward too much.** A stored scope the wire cannot parse is read as
  none (`chain/load.ts`), so the edition is named as before.
- **Page.** The Steckbrief chip reads „zu prüfen“ for `check`. Its peek says
  why the edition applies, or which fact decides it, in the country's terms
  (the fact definitions' labels), with the provision its row cites, and opens
  the edition's text at the page its manifestation cites first
  (`GraphEdition.sourceUrl`).
- **Austria.** `configs/knowledge-packs/at-scopes.json`: the 2019 and 2023
  editions of OIB-RL 2.1, 2.2 and 2.3 again, each with `appliesWhen`, a change
  request of its own after `at.json`. None of the three states its scope in a
  clause: Punkt 1 refers to the „OIB-Richtlinien – Begriffsbestimmungen“, and
  Punkt 0 holds caveats. So each scope is read from the guideline's title and
  the term it defines there, both quoted from the published PDFs, the 2019
  and 2023 definitions being word for word the same:
  - 2.1 „Brandschutz bei Betriebsbauten“, a Betriebsbau being a building that
    „der Produktion … bzw. der Lagerung von Produkten oder Gütern dient“:
    `uses` ∋ `production` applies. An agricultural or technical building
    without it is left to a person, since Punkt 0 counts a building for
    technical installations as a Betriebsbau with relief. Any other building
    is out of scope.
  - 2.2 „… Garagen, überdachten Stellplätzen und Parkdecks“: `uses` ∋
    `garage`. Mixed use is per use (OIB-RL 2, Punkt 0), so a garage part brings
    2.2. Garages of at most 15 m² are in scope with no requirements (Punkt 0),
    and no fact tells them apart.
  - 2.3 „… mit einem Fluchtniveau von mehr als 22 m“: `escape_level_m` > 22.

### Consequences

- Good: once `at-scopes.json` is published, a block of flats no longer names
  OIB-RL 2.1, on the page or in the answer, and the chip says why the ones it
  names apply.
- Good: a second country states its own editions' scopes by proposing them,
  with no code change.
- Bad: a scope can only read a fact the intake asks. A scope that turns on
  something the profile does not hold (a Betriebsbau's fire compartment size)
  can only answer `check`.
- Bad: until the scopes are published in an environment, nothing narrows
  there, as before this change.
- Neutral: the removed OIB list also graded OIB-RL 4, 5 and 6 by main use
  („stronger for publicly used buildings“). That was a hint, not scope: those
  texts apply to every building, and they get no scope.

### Confirmation

- `bff/base-knowledge/rulesets/applicability.spec.ts`: true, false and
  undetermined per building; the strongest verdict across buildings; open
  facts; a table the evaluator cannot run; the wire refuses a non-boolean
  output.
- `bff/base-knowledge/context/project-law.spec.ts`: through the real
  resolver, a scoped edition is named for a production building with its
  reason, label and source, and not for flats.
- `bff/base-knowledge/chain/text.spec.ts`: the agent is told which fact
  decides, and a dropped edition is absent.
- `bff/base-knowledge/platform/validate.spec.ts`: the kit runs the scope's
  examples.
- `bff/base-knowledge/chain/chain.integration.spec.ts`: the loader reads
  `applies_when` and the source page.
- `bff/base-knowledge/chain/at-scopes.spec.ts`: Austria's scopes pass the
  kit against the pack with their examples, change nothing of an edition but
  its scope and citations, and in Vienna name 2.2 for flats over a garage, 2.1
  for a production hall, 2.3 past 22 m, ask for an open escape level, and
  leave a farm building's 2.1 to a person.
- `bff/base-knowledge/platform/record-schemas.spec.ts`: the record schemas,
  with the decision table written once, fit one tool result on the door.
- `scripts/rls-test-db.sh` (0216): the object CHECK, down and reapply.
- `ui/features/project-intake/components/steps/profile-step.spec.tsx`: the
  chip and its peek.

## More Information

The agent reads `applicability` on each use as plain data. Nothing in the
Python tier changes for the narrowing itself, since a dropped edition is
simply not in the turn.

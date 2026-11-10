---
status: proposed
date: 2026-11-10
decision-makers: engineering, with the product owner's acceptance of Wave 5 ("the building-narrowed OIB list returns as data")
consulted: ADR-0166 (rulesets and the one evaluator), ADR-0168 (the chain), ADR-0169 (setup facts), ADR-0173 (the knowledge context), ADR-0175 (the cut-over)
informed: everyone who reads an answer or a Steckbrief about the law of a site, and operators who publish a country
---

# A work applies to a project by its buildings, decided by applicability rulesets the chain runs

## Context and Problem Statement

The chain (ADR-0168) decides which edition binds a site: by territory and by
the routes that make a model code or a standard binding there. It knows
nothing of the building. Austria's Länder make OIB-RL 2.1 (Betriebsbauten),
2.2 (garages) and 2.3 (escape level over 22 m) binding as a set, so after the
cut-over (ADR-0175) removed `bff/oib`, which narrowed them in code, every
Austrian project named all three, a block of flats included. The answer and
the Steckbrief read a guideline as binding on a building it is not written
for.

Whether a work applies to a building is a question of the work's scope, and
the scope is law: it differs between works and countries and changes with
editions. It belongs in the records, reviewed like any other claim, not in a
TypeScript twin of a Python list.

## Decision Drivers

- One answer, read from records: the turn, the Steckbrief, `project-base-get`
  and a research run name the same works for the same building.
- The evaluator that classifies a building (ADR-0166) is the only place a rule
  over building facts runs.
- No country and no work is named in code.
- Fail toward too much law, never too little: a narrowing that cannot be
  trusted narrows nothing.

## Considered Options

1. Keep naming every work the routes reach, and let the agent judge scope from
   the text.
2. A fifth decision purpose, `applicability`: a table per work over the
   building's facts, run by the chain.
3. Conditions on the `makes_binding` relation, so a route binds only when the
   building matches.

## Decision Outcome

Chosen option 2.

- Option 1 is rejected on the premise that the turn reads the chain's roles as
  given: a work the chain names binding is cited as binding (ADR-0168,
  `citations/roles.py`). Were the agent ever to weigh scope from the text
  before citing, the cost would be a wrong chip on the page only.
- Option 3 is rejected on the premise that scope belongs to the work, not to
  the route: nine Länder route OIB-RL 2.1, and the Betriebsbau condition would
  be written nine times, each a place to drift. Were a Land to narrow a
  work's scope by its own law, a route condition would be the right form for
  that difference, and this decision would not stop it.

What it is:

- **Record.** A ruleset with `purpose: 'applicability'` (migration 0214,
  provisional number), a `decision_table.v1` whose output is a code among
  `applies`, `check`, `not_applicable` (`APPLICABILITY_VERDICTS`), and at
  least one `workIds` entry (the CHECK `knowledge_ruleset_revisions_applicability_targets`
  and the wire both refuse one without). It is selected like any decision
  table: nearest node on the site's chain, work-targeted (`rulesets/select.ts`).
- **Evaluation** (`rulesets/applicability.ts`, `applicabilityOf`). The table
  runs once per building on the building's facts, read through the country's
  `fact_definitions` (the intake's own readers). The project's verdict is the
  strongest any building gives: one production hall makes the project need
  OIB-RL 2.1. An open fact reads `check` and names the facts that would decide
  it; no building described yet is one building with every fact open. Two
  tables at one node, or a table the evaluator cannot run, read `check`.
- **Chain.** `resolveChain` takes the building scope. A work no building needs
  is dropped, every edition of it; each other use carries `applicability`
  (`verdict`, `basis`: the facts the deciding rows read, `open`, `provision`),
  null where no table speaks for its work. The knowledge context and the
  turn's building law both resolve through it; the chain text tells the agent
  when scope waits for a fact and asks for it. The buildings join the context's
  digest, so a changed use re-resolves.
- **Fail toward too much.** A ruleset read that is truncated or holds a body
  the evaluator cannot parse narrows nothing and is logged
  (`chain/building.ts`).
- **Page.** The Steckbrief chip reads „zu prüfen“ for `check`; its peek says
  why it applies or which fact decides it, in the country's terms (the fact
  definitions' labels), the provision its row cites, and opens the edition's
  text at the page its manifestation cites first.
- **Austria.** Three records in `configs/knowledge-packs/at-applicability.json`:
  OIB-RL 2.1 by `uses` ∋ `production` (`agriculture` or `technical` to check),
  2.2 by `uses` ∋ `garage`, 2.3 by `escape_level_m` > 22. A change request of
  their own, after the Austria pack, which is at the 200-record cap of one
  request; they name its works.

### Consequences

- Good: a block of flats no longer names OIB-RL 2.1, on the page or in the
  answer, and the chip says why the ones it names apply.
- Good: a second country narrows its own works by proposing tables, with no
  code change.
- Bad: what a table reads must be a fact the intake asks. A scope that turns on
  something the profile does not hold (a Betriebsbau's fire compartment size)
  can only answer `check`.
- Bad: until the tables are published in an environment, nothing narrows
  there, as before this change.
- Neutral: the removed OIB list also graded OIB-RL 4, 5 and 6 by main use
  („stronger for publicly used buildings“). That was a hint, not scope: those
  works apply to every building, and no table is written for them.

### Confirmation

- `bff/base-knowledge/rulesets/applicability.spec.ts`: Austria's tables as the
  pack proposes them; the strongest verdict across buildings; ambiguity and no
  table.
- `bff/base-knowledge/chain/packs.spec.ts`: the tables validate against the
  Austria pack, and their examples run in the platform's kit.
- `bff/base-knowledge/context/project-law.spec.ts`: through the real resolver,
  OIB-RL 2.1 is named for a production hall with its reason, label and source,
  and not for flats, on the page and in the turn; a read that cannot be trusted
  narrows nothing.
- `bff/base-knowledge/chain/text.spec.ts`: the agent is told which fact decides.
- `bff/base-knowledge/wire/vocab.spec.ts` and `scripts/rls-test-db.sh` (0214):
  the purpose and the target CHECK.
- `ui/features/project-intake/components/steps/profile-step.spec.tsx`: the
  chip and its peek.

## More Information

The agent reads `applicability` on each use as plain data; nothing in the
Python tier changes for the narrowing itself, since a dropped work is simply
not in the turn.

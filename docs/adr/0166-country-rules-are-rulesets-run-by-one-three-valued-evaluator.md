---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §3.6 and §3.7) and its build split (S13)
informed: the slices that decide from rulesets (S8 Austria, S9 setup facts, S11 time and editions, S16 Germany)
---

# Country rules are rulesets, decision tables in the base knowledge records, run by one three-valued evaluator

## Context and Problem Statement

Which building class a project falls in, which authority is competent, which
reference date applies and which setup facts matter are country rules. Today
the one that exists is code: Austria's OIB Gebäudeklasse is
`apps/workspace/bff/project-intake/derivations.ts`, and it decides with missing
inputs by enumerating every band of every missing input. A second country
would be a second module, and so would every reference-date and competence
rule after it (design §3.7; ticket 30).

A rule must also answer while facts are missing, without guessing: a project
with no Fluchtniveau entered has no Gebäudeklasse yet, and the answer should
name the facts that could still change it and no others.

## Decision Drivers

- A new country adds data, not code: one evaluator, one record shape.
- Fail closed: a missing fact is unknown, never false; a fact of the wrong type,
  an operator outside the subset, two rulesets for one node and date, or a node
  with no rule is an error or `undetermined`, never a default.
- "Ask only what can change the classification": an undetermined answer names
  exactly the facts it waits for.
- Buy, don't build: a published standard for the table and its conditions, and
  the library as the oracle.
- The rules live where the rest of the base knowledge lives (ADR-0163), with
  its owner, history, RLS and review.

## Considered Options

1. Keep rules as code per country (`derivations.ts` and its siblings).
2. Decision tables (DMN, hit policy FIRST) whose conditions are JsonLogic, run
   by a library such as `json-logic-js` or `json-logic-engine` directly.
3. The same tables, run by an evaluator of our own over a closed JsonLogic
   subset in Kleene's three-valued logic, with `json-logic-js` as the oracle.
4. DMN with FEEL conditions (`feelin`), whose `null` already propagates.

## Decision Outcome

Chosen option 3.

- **Record.** A ruleset is a fourth base knowledge record type beside work,
  edition and manifestation (migration 0204): a header in `knowledge_records`,
  revisions in `knowledge_revisions`, and its body in
  `knowledge_ruleset_revisions`: `purpose`, `territory_ids`, `work_ids`,
  `valid_from` and an exclusive `valid_to`, `basis_edition_id`, and either a
  table (`payload_schema` `decision_table.v1`, `payload`) or
  `inherits = 'parent'`, never both (CHECK). Purposes are
  `classification`, `derivation`, `reference_date` and `competence`, which are
  decision tables (ADR-0176 adds `applicability`, a fifth), plus `fact_definitions`, `fact_sources`, `advice_policy` and
  `terminology`, which get their payload schema in the slice that first reads
  them. The wire is `bff/base-knowledge/wire/ruleset.ts` (zod).
- **Table.** `decision_table.v1`: typed `inputs` (`number`, `boolean`, `code`,
  `codes`, `date`), an `output` (`code`, `boolean`, `event`, `bodies`,
  `quantity`), `rows` of `{id, when, then, provision?}`, `otherwise` (a value or
  `undetermined`), and `examples`. The schema refuses a row that reads an
  undeclared fact or answers a value the output does not declare; a write also
  runs the examples (`writableRuleset`).
- **Conditions.** JsonLogic restricted to `var` (no default), `and`, `or`, `!`,
  `===`, `!==`, `<`, `<=` (two or three arguments), `>`, `>=`, `in` over a list,
  `+ - * /`, `min`, `max`, and `all`, `some`, `none` over a list, whose
  predicate reads only the element (`var ""`), as JsonLogic scopes it. Typed,
  and checked when the table is written: connectives take booleans,
  comparisons two numbers or two ISO dates, arithmetic numbers, and a condition
  is a boolean. A mistyped condition is refused then, not on the day its facts
  are answered, and the subset and JsonLogic agree wherever both answer
  (`bff/base-knowledge/rulesets/expression.ts`).
- **Semantics.** Kleene's strong logic: an unknown fact makes an expression
  unknown unless the known part decides it, and an unknown value carries the
  facts it waits for. Rows apply first-hit (DMN FIRST): a row known false is
  passed; the first row known true decides unless an earlier row is unknown, in
  which case the result is `undetermined` with the unknown inputs of every row
  not yet excluded, in input order, and the candidate rows
  (`rulesets/decision-table.ts`).
- **Selection.** `rulesets/select.ts` takes the site's territory chain, leaf
  first, and a date. Classification, derivation and competence take the deepest
  node with a ruleset (`nearest`); a reference date is the legislating node's
  own or, only when that node says `inherits: parent`, its parent's
  (`explicit`). No ruleset is `undetermined: no_rule`; two for one node, purpose
  and date are `ambiguous_rules`. A work-targeted ruleset wins for its works.
- **Austria first.** `rulesets/seeds/at-oib-2023-building-class.json` holds the
  OIB 2023 classification as data; `rulesets/building-class.ts` reads a
  Building's profile into facts and returns `deriveBuildingClass`'s own shape.
  Nothing in the product decides from it yet: S9 moves the derivation onto it
  and deletes the coded rules.

### Rejected options and the premise each rests on

- **Option 1** rests on there being one country. The international design adds
  Germany, Switzerland and others in 2026–2027.
- **Option 2** rests on `json-logic-js` 2.0.5 and `json-logic-engine` 5.0.7
  reading a missing `var` as `null` and evaluating on: `{"<=": [{"var":
  "storeys"}, 3]}` is `true` with no storeys entered (shown in
  `expression.spec.ts`). Neither has a three-valued mode. If one gains one, it
  replaces `expression.ts` and the specs stay.
- **Option 4** rests on FEEL being text that needs a parser to list a
  condition's facts and to check it against declared inputs, while JsonLogic is
  JSON a zod schema and a twenty-line walk can check; FEEL's `null` also does
  not say which input it came from.

### Consequences

- Good: a country adds rows. Germany's competence and reference-date rules,
  Switzerland's classification and every later one are records, reviewed and
  versioned like any other base knowledge.
- Good: the undetermined answer is exact on Austria's rules: the derivation's
  14 shared cases, its threshold cases and 3,000 generated Buildings (each
  input on, beside or without its threshold) give the same class and the same
  missing inputs as the enumeration.
- Bad: Kleene's logic is sound but not complete in general. A condition such as
  `x <= 3 or x > 3` is unknown for an unknown `x` though every value decides it,
  and two rows with the same `then` both count as candidates. Table authors keep
  conditions free of tautologies; the property specs check soundness (a
  decision holds for every completion) and sufficiency (answering the named
  facts decides), not minimality.
- Bad: one row per value where data would list it. A competence row names its
  authority; Germany's Kreis rule (the Kreis of the site, for 400 Kreise) wants
  a `lookup` of the authority by territory and function, which waits for the
  authority records (S7).
- Neutral: platform rulesets need the platform write path (design §4.4); until
  then an office can hold its own, and RLS keeps a tenant from writing a
  platform row.

### Confirmation

`bff/base-knowledge/rulesets/expression.spec.ts`: agreement with `json-logic-js`
on known facts, soundness and sufficiency on partial facts, the refusals.
`decision-table.spec.ts`: first hit against a reference loop over
`json-logic-js`, candidates, exact unknown inputs. `building-class.spec.ts`:
parity with `deriveBuildingClass`. `select.spec.ts`: E32 on synthetic
territories, inheritance, validity, ambiguity.
`store/rulesets.integration.spec.ts` (in `task db:test:rls`): isolation with a
positive control, append-only, the table-or-inherits and table-purpose CHECKs,
no tenant-written platform row, E32 from a stored ruleset.
`wire/vocab.spec.ts` holds the CHECKs to the vocabularies.

## More Information

Design `docs/design/international/design.md` §3.6 and §3.7, build split S13
(branch `claude/intl-design`). JsonLogic: jsonlogic.com. DMN 1.5, hit policy
FIRST. Kleene's strong three-valued logic.

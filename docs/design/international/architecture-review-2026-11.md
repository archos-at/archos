# Architecture review after Wave 5, 2026-11-10

Three independent reviewers read develop at `dc6f6cea` and the open Wave 5 PRs, each in one area:
- the knowledge model;
- how the agent gets law, and the door;
- how knowledge gets in, and its governance.

They answered the same four questions:
1. Is there one concept per thing?
2. What is overbuilt?
3. What breaks when Germany or an EU Eurocode with a national annex comes in?
4. Are the layers clean?

The bar is the owner's: the design must make architectural sense, must not be overbuilt, and must be ready for the future. The coordinator re-checked the top findings before routing them. A fact-check against develop at `ad732027` (with #1579 and #1580) then corrected several claims, and the text below reflects it. Figures marked *estimate* are projections, not measurements.

**What holds.**
- Records with append-only revisions, release moves and four-eyes review.
- The one rule evaluator, typed relations and coverage held on the territory record.
- One exposure file for the door.
- The BFF as the single writer.
- The base corpus filtered by country in the vector store.
- *Judgement, not a check:* an EU Eurocode with a national annex appears to fit without a schema change. EN and DIN EN/NA are separate works, the NA `deviates_from` the EN, and the VV TB references both. Germany appears to fit the relation and ruleset model once the items below are done.

## Findings, ranked, with owners

Owners are the build sessions listed in [`build-split.md`](build-split.md#after-wave-5-sessions).

| # | Finding | Why it matters | Change | Owner |
|---|---|---|---|---|
| 1 | The database enforces approver ≠ author (0205:321-334, 0214:61-72). But `knowledge_required_approval_roles` never requires `domain_expert` (0212:183-192), and `knowledge_change_requests.status` has only a CHECK, with no transition trigger. | The first approval in any role approves legal content, and the publish trigger trusts the status. | Require `domain_expert`; add a status-transition trigger. | S18 |
| 2 | Approve-alone defers the source check to the second review (0214:94-99, 171). | Operator-supplied text can be published, with the person's yes and `approve_alone`, before anyone has compared it to its source (ADR-0170). | Keep the source check unconditional; approve-alone works only on fetched evidence. | S18 |
| 3 | The turn carries two answers to which law applies (`buildingLaw` and `knowledgeContext`). Each loads the graph and places the site its own way (`projectTerritory` vs `siteLeaves`), and only one applies the coverage and freshness corrections. | A citation can say binding where the gate says information. A cold turn loads the graph twice; the context is cached for 10 minutes. | One payload: uses carry the text, designation and `sourceRefs`. `chain/turn.ts` is deleted. | R2 (#1584), R1 (#1582) |
| 4 | (Code in open PRs #1584 and #1582.) `sourceRefs` lives per edition, but the Bauordnungen have works and no editions. The wire was a bare `"key:value"` string, and the first parser never matched. | The RIS binding badge could never appear for the case it was built for. | Identifiers on the work (`work.identifiers` already exists). Structured `{scheme, value}`, with a fixture-fed test. | R2, R1 |
| 5 | The turn contract is mirrored by hand in Python. Only `EDITION_ROLES` is pinned by a test (test_roles.py:64); the other enums match today by hand. | Silent drift between the BFF and the agent. | A JSON Schema generated from zod, and a Python test against the generated fixture. | R2 |
| 6 | "Edition in force on a day" is implemented three times with two end-date rules: chain/resolve.ts:73 excludes the end; time/editions.ts:34 and validate.ts:131 include it, as the wire defines it. The turn never uses the reference date (context/service.ts:133). | A law drops out on its last day. Germany's Stichtag per procedure × Land can't plug in. | One function, end-excluded intervals, `editionFor(workId)`, and as-of read through the BFF. | M1 |
| 7 | Site placement is computed four ways. The Länder list and setup come from Austrian seeds in code. | A German site never gets a Land, and published German rules are never read. | One `siteLeaves`. Setup and picker read published records. The seeds move into the `at` pack. | M1 |
| 8 | Hitting the 2,000-row or 40-use limit sets the gate to `knowledge_unavailable`: all law is withheld while the turn runs. | *Estimate:* the VV TB would withhold law from every office entitled to DE, and Austria may near 40 as more ÖNORMs are listed. | Read relations from the chain's seeds. Treat 40 as a send budget, never withhold everything. | M1 |
| 9 | Applicability of a guideline to a building is built as a new ruleset purpose (#1589). | Rulesets are territorial (1-50 `territory_ids`), but a scope clause is per edition (the OIB-RL 2.3 thresholds differ between 2019 and 2023). | `applies_when` as a decision table, through the one evaluator, on the **edition** body. Design §3.4 (design.md:166) puts it on the work as JsonLogic and is updated with the reason. Building facts go into the context digest. | R2 (#1589) |
| 10 | Untrusted PDFs are parsed in the api pod. | That pod reaches the database and the cluster. | Parse in the fetcher pod (public egress only, no secrets). The fetcher becomes mandatory. | S17 |
| 11 | Approve-alone is a second state machine: 5 columns, a table, a 5-valued state, and its rules held three times (SQL, decide.ts, change-request-review.tsx). | *Estimate:* about 17 reachable state combinations, and the UI re-derives rules that can drift. | The override is an approval with a reason. The second review is an ordinary later approval. The owed review is derived. `allowedActions` on the read. | S18 |
| 12 | The answer check does not see the law block or tool failures, while prompts tell the model to "keep confidence below high", which sets no level. | The binding edition, the first claim in an answer, is the one nobody checks. | Give the check the law block, the gate note and failed calls. Drop the nudges. | R1 (after #1582) |
| 13 | The law gate is enforced in the client, not at the tool. `norm-list` still teaches the old binding model on the door. | Every new agent client inherits an ungated `law-lookup`. | Gate in the tool. `norm-list` withheld. Rewrite the `law-lookup` description. | R1 |
| 14 | Visibility, territory parents and directive applicability are each written three or four ways. | A DIN edition binds in the chain but gives 404 on as-of. The EU never shows up on the time path. Directive verdicts will disagree in Germany. | One predicate (the RLS one), one `parents` field, and competence decides. | M1 |
| 15 | Country tables live in code: time zones, the RIS→AT map, the OIB regex, the dialect line in the cached prompt, Land parsing from text. | *Estimate:* a second country edits about seven places. | Read them from territory and source records and from the turn context. | M1 |
| 16 | One concept, two homes: source protocols in three lists, sources in YAML and records, home country in WorkOS and the database, pack copy in files and records. | Drift. A new engine needs a migration. | One list generated from Python, sources as records, home country written on `organization.created`, website copy from `coverage-get`. | S17, S18, M1 |
| 17 | Overbuilt: | — | **Delete** (see the list below). | S18, R1, R2 |

The overbuilt items to delete:
- the preview channel: only release.ts reads it, to gate a publish, and no content reader exists;
- the `second_reviewer` role: live, but nothing requires it (a recommendation, not dead code);
- the `timeEditions` shim, once #1582 deploys;
- `binding_note` in the TS citation wire;
- the second, context-less job-submit path;
- the legal method written in two places;
- passage-to-edition mapping by file name, when chunks carry `edition_id`.

## Not now

- A monitor per document (key monitor state by manifestation URL): S17, after the source registry is one.
- Per-country permissions: `platform:knowledge:write` and `:review` come first (S18); scoping by country waits for WorkOS FGA.
- One confidence rule for deep research (`claim_judge` on the report): R1, after the chat path.

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

The bar is the owner's: the design must make architectural sense, must not be overbuilt, and must be ready for the future. The coordinator re-checked the top findings in the code before routing them.

**What holds.**
- Records with append-only revisions, release moves and four-eyes review.
- The one rule evaluator, typed relations and coverage held on the territory record.
- One exposure file for the door.
- The BFF as the single writer.
- The base corpus filtered by country in the vector store.
- An EU Eurocode with a national annex fits without a schema change: EN and DIN EN/NA are separate works, the NA `deviates_from` the EN, and the VV TB references both. Germany fits the relation and ruleset model once the items below are done.

## Findings, ranked, with owners

| # | Finding | Why it matters | Change | Owner |
|---|---|---|---|---|
| 1 | Four eyes is not held by the database. `knowledge_required_approval_roles` never requires `domain_expert`, and `knowledge_change_requests.status` has no trigger. | One approval in any role publishes legal content to every entitled office. | Require `domain_expert`; add a status-transition trigger. | S18 |
| 2 | Approve-alone waives the source check (0214). | An agent could approve a page it pasted itself (ADR-0170). | Keep the source check unconditional; approve-alone works only on fetched evidence. | S18 |
| 3 | The turn carries two answers to which law applies (`buildingLaw` and `knowledgeContext`). Each loads the graph and places the site its own way, and only one applies the coverage and freshness corrections. | A citation can say binding where the gate says information. Every turn loads the graph twice. | One payload: uses carry the text, designation and `sourceRefs`. `chain/turn.ts` is deleted. | R2 (#1584), R1 (#1582) |
| 4 | `sourceRefs` lives per edition, but the Bauordnungen have no editions. The wire was a bare `"key:value"` string, and the first parser never matched. | The RIS binding badge could never appear for the case it was built for. | Identifiers on the work (`work.identifiers` already exists). Structured `{scheme, value}`, with a fixture-fed test. | R2, R1 |
| 5 | The turn contract is mirrored by hand in Python, and the enums already differ. | Silent drift between the BFF and the agent. | A JSON Schema generated from zod, and a Python test against the generated fixture. | R2 |
| 6 | "Edition in force on a day" exists three times, with three end-date rules. The turn never uses the reference date. | A law drops out on its last day. Germany's Stichtag per procedure × Land can't plug in. | One function, end-excluded intervals, `editionFor(workId)`, and as-of read through the BFF. | A1 |
| 7 | Site placement is computed four ways. The Länder list and setup come from Austrian seeds in code. | A German site never gets a Land, and published German rules are never read. | One `siteLeaves`. Setup and picker read published records. The seeds move into the `at` pack. | A1 |
| 8 | 2,000-row and 40-use limits fail the whole turn. | Germany (VV TB) fails every turn of any office entitled to DE, and Austria will hit 40 soon. | Read relations from the chain's seeds. Treat 40 as a send budget, not a refusal. | A1 |
| 9 | Applicability of a guideline to a building was planned as a new ruleset purpose. | Rulesets are territorial, but a scope clause is per edition. | `applies_when` (a decision table) on the edition body, as design §3.4 says. Building facts go into the context digest. | R2 (item 8) |
| 10 | Untrusted PDFs are parsed in the api pod. | That pod reaches the database and the cluster. | Parse in the fetcher pod (public egress only, no secrets). The fetcher becomes mandatory. | S17 |
| 11 | Approve-alone is a second state machine: 5 columns, a table, a 5-valued state, and its rules held three times. | About 17 reachable state combinations, and the UI re-derives rules that can drift. | The override is an approval with a reason. The second review is an ordinary later approval. The owed review is derived. `allowedActions` on the read. | S18 |
| 12 | The answer check does not see the law block or tool failures, while prompts tell the model to "keep confidence below high", which sets no level. | The binding edition, the first claim in an answer, is the one nobody checks. | Give the check the law block, the gate note and failed calls. Drop the nudges. | R1 (after #1582) |
| 13 | The law gate is enforced in the client, not at the tool. `norm-list` still teaches the old binding model on the door. | Every new agent client inherits an ungated `law-lookup`. | Gate in the tool. `norm-list` withheld. Rewrite the `law-lookup` description. | R1 |
| 14 | Visibility, territory parents and directive applicability are each written three or four ways. | A DIN edition binds in the chain but gives 404 on as-of. The EU never shows up on the time path. Directive verdicts will disagree in Germany. | One predicate (the RLS one), one `parents` field, and competence decides. | A1 |
| 15 | Country tables live in code: time zones, the RIS→AT map, the OIB regex, the dialect line in the cached prompt, Land parsing from text. | A second country edits about seven places. | Read them from territory and source records and from the turn context. | A1 |
| 16 | One concept, two homes: source protocols in three lists, sources in YAML and records, home country in WorkOS and the database, pack copy in files and records. | Drift. A new engine needs a migration. | One list generated from Python, sources as records, home country written on `organization.created`, website copy from `coverage-get`. | S17, S18, A1 |
| 17 | Overbuilt: | — | **Delete** (see the list below). | S18, R1, R2 |

The overbuilt items to delete:
- the preview channel, which nothing reads;
- the `second_reviewer` role;
- the `timeEditions` shim, once #1582 deploys;
- `binding_note` in the TS citation wire;
- the second, context-less job-submit path;
- the legal method written in two places;
- passage-to-edition mapping by file name, when chunks carry `edition_id`.

## Not now

- A monitor per document (key monitor state by manifestation URL): S17, after the source registry is one.
- Per-country permissions: `platform:knowledge:write` and `:review` come first (S18); scoping by country waits for WorkOS FGA.
- One confidence rule for deep research (`claim_judge` on the report): R1, after the chat path.

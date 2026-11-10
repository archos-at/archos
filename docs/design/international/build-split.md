# Country base knowledge: the build, split across parallel sessions

Source: design v7 (`docs/design/international/design.md` on branch `claude/intl-design`, Part I) plus the v7 review findings. Updated 2026-11-06 against `develop` at `cae35262`.

**What changed since the design was checked (`4fb7b836`):** 39 commits. Migrations now run to 0199 and ADRs to 0157, so no numbers are reserved here: each session takes the next free number and the orchestrator renumbers at merge. ADR-0154 put platform staff's MCP traffic through agentgateway, and #1518 admits platform staff whatever organization they signed in with; the cross-office conversation and feedback operations are still on the platform door (the `conversations` block of `exposure.config.ts`), so S4 matters more, and must cover the gateway. Project mail landed (inbound mail, in-cluster ClamAV, ADR-0157): a new flow for S5. Ticket 32 is still "Neu". feld72 already uses Claude over MCP to sort its office knowledge, which supports "Claude is the onboarding agent".

## Intent over instructions

Every session gets **intent**, not a recipe: the outcome, why it matters, and the few fixed points other sessions depend on. Everything else in this document, including the design's tables, names and steps, is a **suggestion** from design v7. A session that finds a simpler or better way is expected to take it. It says so in the PR under "Better than the brief", with the reason, so the orchestrator can carry the change to the sessions that depend on it.

Only three kinds of thing are fixed:
1. **Interfaces other sessions build on** at the same time: the shared record shape, migration numbers, flag names, file ownership. A session may still change one, but it flags it in its PR first so dependants are told, rather than diverging silently.
2. **Safety:** tenant isolation, licensed text never leaving its seam, the person's yes on publish, the ask-first steps.
3. **The repo's own gates and rules** (AGENTS.md).

Each brief below lists "Outcome", "Why", "Fixed" and "Design suggests". Only the first three bind.

## How it runs

- **One orchestrator** (this session) and **parallel cloud sessions**, each in its own container with its own CPU budget. The local workflow cap of 2 agents does not apply across sessions.
- **One session = one PR = one branch** `claude/intl-<slug>`, based on `develop`, PR into `develop`. Wave 2 sessions that need S1 base on S1's branch; CI runs on PRs whose base is a `claude/**` branch (CONTRIBUTING.md).
- **A thin contract, as text.** In Wave 1 only S2 depends on S1's tables, so there is no code contract to wait for; from Wave 2 on, sessions base on merged work. The shared points (record shape, licence values, flag names, file ownership) are written in each brief, and S1 owns the tables. Wave 0 is only the design on a branch every session can read. A session that finds a better shape proposes it in its PR, and the orchestrator reconciles.
- **The orchestrator** spawns sessions, watches them (`get_session`, `list_events`), reviews each PR against its intent (not against the suggestions) with an independent reviewer, carries good deviations to dependent sessions, fixes the stacking order and rebases. Sessions can message back but often do not, so the orchestrator reads PR and check state from GitHub directly (open PRs by branch `claude/intl-*`) at every check-in; on 2026-11-10 two PRs (#1545, #1546) sat unnoticed for an hour because the orchestrator waited for a message. Each session finishes by opening its PR with the sections the orchestrator reads.
- **Gates in every session:** `task verify:fast`, plus `task db:test:rls` for a tenant-boundary change, `task pkg:test` for `packages/`, and `task be:eval:answer-suite` before and after anything that shapes answers, with the report in the PR. Conventional PR title, a release note per slug, and the definition-of-done checklist.
- **Scout with Haiku, build with the session's own model.** Reading the code to find where something lives, which callers a change touches, or what a test asserts is scouting: hand it to Haiku subagents, several in parallel, each with a narrow question and a short written answer. The session's own context stays for design and code. Scouts report findings; the session re-checks any fact before it relies on it or writes it down.
- **Push after every green slice.** A session can stop at any moment on a budget or container limit, and a container is reclaimed after a few idle days. On 6 November all six Wave 1 sessions stopped on a budget limit within half an hour, and three had pushed nothing. Work that is not on `origin` does not exist.
- **Ask-first steps stay with a person:** `task prompts:push -- --apply`, `task workspace:provision:authz -- --apply`, migrations against a shared database, and Langfuse provisioning. Sessions prepare them and stop.

## Waves

| Wave | Sessions in parallel | Starts when | Rough wall clock |
|---|---|---|---|
| 0 | the orchestrator alone: the design on `claude/intl-design` | now | minutes |
| 1 | S1 Office layer · S2 Licensed seam · S3 Correctness · S4 Door split · S5 Data-flow register · S6 Connector types | design branch pushed | 3 – 5 h |
| 2 | S7 Platform records, review, entitlements · S13 Rulesets and the evaluator · S14 Residency | S7 and S13 when S1 is merged; S14 when S2 and S5 are merged. **S14a AI Act marking starts now**, alone: it needs nothing else, and it is due 2026-12-02 | 4 – 6 h |
| 3 | S8 Austria as pack 1 · S9 Setup facts · S10 Agent-grade door · S11 Time and editions · S12 Address resolution | S7 merged; S9 and S11 also need S13 | 4 – 6 h |
| 4 | S15 Turn context and gate · S16 Onboarding tooling | S15 when S8, S9, S11 and S12 are merged; S16 when S6, S7, S10 and S13 are | 3 – 5 h |
| 5 | Cut-over: Austria's data through the platform door, then R1 agent · R2 workspace (below) | S10, S15 and S16 merged and in production | data load plus 1 release |
| end | The build ends with the old paths gone and the tooling to onboard any country. Onboarding a country, Germany first, is run elsewhere (decided 2026-11-10) | Wave 5 done: Austria's data stable in production, R1 and R2 merged | — |

About 2 – 3 days of wall clock for the code if PRs are merged as they turn green. Your review and merge sit on the critical path, not the writing. The dated edge cases and the week table in `design.md` were written before this split; the waves replace them, and no date there is a commitment.

```
Wave 1                 Wave 2                     Wave 3                   Wave 4
S1 office layer ──┬──> S7 platform records ──┬──> S8 Austria pack ──┐
S2 licensed seam  │                          ├──> S10 agent door ───┼────────────────────────┐
S3 correctness    ├──> S13 rulesets ─────────┼──> S9 setup facts    │                        ├──> ready to onboard
S4 door split     │                          ├──> S11 time+editions ┴──> S15 turn context ───┤
S5 register ──────┴──> S14 residency         └──> S12 addresses                              │
S6 connectors ──────────────────────────────────────────────────────> S16 onboarding tooling ─┘
S14a AI Act marking (now, alone)
```

## Coverage

On 2026-11-10 an independent reviewer mapped every buildable item of `design.md` (304: records, operations, flags, tests, scores, guards, edge cases E01–E48, test rows T30–T32, ADRs, tickets) and the `codebase-map.md` defects to this split. The first version left 91 items with no home, chiefly the evaluator and rulesets (3.7), the turn context and gate (4.6, 5.5), and residency B3 with the AI Act deadline (6.4–6.7), so Germany L0 could not have run on it. A second check of the revision found seven still open and five new ordering problems; the second revision closes them, so every item now has a home: a session below, the Germany L0 operation, or "Not in this build" with the trigger that brings it back. S8 and S9 moved to Wave 3 because they need S7's records and S13's evaluator.

**Every session also:** writes the ADR the design's ADR table assigns to its part (next free number); declares the Langfuse scores its part produces in `SCORE_DEFINITIONS` and the trace metadata fields it sets (design 7.3); adds its consumers to `consumers.ts` (S1 creates it) so the anti-relapse spec grows with each part.

**Ownership where two sessions touch one thing:**
- The geocoder: S3 switches komoot off by default; S5 registers it.
- The live defects of design 2.2: S3 fixes 1 – 4 and 8 (and switches off 9); S9 fixes 5 (`withDerivedClass` and `bim/rules.ts` deriving OIB classes for any project); S8 fixes 6 (the static `<building_law>` block) and 7 (OIB-RL 2023 counted as binding in every Land), through chain text and adoption relations.
- `common/openrouter.py`: S2 owns the seam expansion in Wave 1; S14 adds per-role routing and `processing_location` on top after S2 is merged.
- ADR authorship where a design ADR spans sessions: S6 writes the connector ADR, and S16 amends it for monitors and source operations; S13 writes the axes-and-competence ADR, which S7 and S15 cite.
- `personDecides`: S7 builds the primitive for approve, publish, rollback and entitlement; S10 reuses it on the door.
- Idempotency keys and RFC 9457 problems: S1 builds the shared helper for office operations; S10 extends it to every door operation.
- Licensed ingest: S1 marks it metadata-only in the pipeline; S2 owns `vision_calls.py`.
- The office answer label ("Büroexemplar … zuletzt geprüft"): S1 supplies the data, S2 renders it.
- `exposure.config.ts`: S4 may edit it to classify every platform operation; everyone else adds operations in new files.
- Platform-dependent parts of S1 (the text-less listing a second office sees, release moves) are stubs behind one interface until S7 replaces them. S6 keeps source configuration in files until S7's records exist.

## Wave 0: the shared points (text, not code)

The design, the codebase map and this split are on branch `claude/intl-design` under `docs/design/international/`. These are the only points sessions share; everything else is theirs to decide.

- **Record shape (S1 owns the tables).** One set of tables for platform and office knowledge, told apart by an owner column (`organization_id`, NULL for platform). Works, editions and manifestations (design 3.4); append-only revisions; a "last checked" record. Platform rows can arrive later as additions, with no data migration.
- **Licence values** S2 keys on: `public_open`, `public_restricted`, `licensed`. Licensed text is marked on its search-index points (S1 writes the mark, S2 enforces it at the model seam).
- **Owner filter in search:** a mandatory office filter on tenant scopes (S1 adds it; everyone else reads through it).
- **Flags,** default off: `officeGrundlagen` (S1), `licensedSeam` (S2), `sourceRouting` (S6), `knowledgeContext` (later).
- **Files nobody but the orchestrator edits during Wave 1:** `apps/workspace/bff/agent-api/exposure.config.ts` (except S4, which classifies every platform operation in it) and `catalog/platform.ts` are over the 600-line limit. New operations go in new files (`catalog/base-knowledge.ts`, `exposure/<area>.ts`) with a one-line spread; the session adding the first one makes the spread.
- **Numbers:** the next free migration and ADR number at the time of writing (`scripts/check_adrs.py --next`); the orchestrator renumbers on merge if two collide.

## Wave 1

### S1 Office layer (ticket 32)
- **Fixed, licensing:** an office licence for office-wide use does not by itself allow AI processing. Licensed text enters indexing, model reads or quotation only after the office confirms its licence covers processing by the hosted AI services; without that, the copy stays metadata-only.
- **Design suggests:** v7 8.1. Office upload, confirm, update, check, remove, search, get. Kinds `technical_standard`, `guideline`, `commentary`, `authority_directive`, `statute`. Edition from the masthead, outline, ISO territory ids, issuer and addressees with the interim authority path, the "zuletzt geprüft" marker (365 days for standards, 180 for directives), `licence_class` with metadata-only ingest, erasure with a receipt.
- **Outcome the review asked for:** office records reuse the same revision history and removal as platform records (no second lifecycle, only "confirmation moves the head"); every office work carries its standard designation (`ÖNORM B 1600:2017`) as an identifier, so a later platform listing attaches instead of duplicating.
- **Fixed, ownership:** `bff/base-knowledge/{store,office}/`, `knowledge-layer/src/vector_store/scope.py` (`ScopeRead` with a mandatory `office_id`, about 20 call sites), office UI and labels.
- **Fixed, leave to another session:** retrieval rendering and model calls (S2).
- **Outcome, measured by:** leak test with a positive control; zero residue after removal; a second office sees "gelistet, kein Text".

### S2 Licensed seam
- **Fixed, product:** the model reads licensed norms in full (whole sections or the whole norm, as the question needs). The cap applies to what an *answer quotes back*, not to what the model reads.
- **Fixed, cost:** the provider's short-lived prompt cache stays usable for licensed text: a breakpoint after the expanded norm, so an agent loop does not pay full price for the same norm on every call. "No caches" means our own persistent stores (Dragonfly, checkpoints, job payloads, traces), not the provider's prompt cache. Measure cost and cache hits with and without.
- **Design suggests:** in our stores licensed text is held as references and expanded to full text just before the request; no licensed text in traces, logs, checkpoints or job payloads (`_observed_vlm_call` writes full vision messages today); answers quote at most `quoteMaxChars` per span; extraction eval on feld72's norms.
- **Fixed, ownership:** `common/openrouter.py`, `vision_calls.py`, the retrieval-to-prompt rendering path, the eval fixture.
- **Outcome, measured by:** an untraced test and an ordering test green; feld72's case answers from its own copy behind `licensedSeam`.

### S3 Correctness and the organization flag
- **Design suggests:** v7 defects 1 – 4 and 8 (`resolve_country`, OIB verdicts outside Austria, `country=at` and confirmed typed addresses in `intake-seed.ts`, Vienna laws in every Land in `applicability.py`, permit extraction and the Fluchtniveau question; defects 5 – 7 belong to S9 and S8); organization rows backfilled with a home country; DE sensitive-data detectors via `stdnum`; komoot off by default.
- **Fixed, ownership:** `intake-seed.ts`, `oib/applicable-standards.ts` (the TypeScript twin of defect 2), `country_profile.py`, `project_context.py`, `common/applicability.py`, `permit_extraction.py`, the intake prompt, a migration (next free number). S3 switches the geocoder off by default; S5 registers it.
- **Fixed, safety:** prepares, does not run the country-neutral static prompt push (ask first).
- **Outcome, measured by:** DE and CH fixtures produce no OIB fact, rule or doctrine; every WorkOS organization has a row; answer suite before and after, with an allowlist of expected diffs.

### S4 Door split (security)
- **Design suggests:** a separate knowledge door (`/api/platform/knowledge/mcp`), or a server-side tool allowlist per OAuth client; every platform operation classified `platform_public` or `tenant_content`; tenant-content operations withheld from any external agent client.
- **Why:** the platform door today also serves cross-office conversation search and feedback (the `conversations` block of `exposure.config.ts`), and WorkOS cannot narrow a token. Claude onboarding a country must never see tenant text.
- **Fixed, ownership:** `agent-api/door/`, `door-principal.ts`, the MCP server routing, a new exposure test.
- **As built (#1548):** no `knowledgeDoor` flag, because a default-off flag would keep the leak open by default; the knowledge door is the existing `/api/platform/mcp`, with all 55 platform operations classified in `agent-api/exposure/platform.ts` (37 platform-public, 18 tenant-content, withheld from every door). The gateway's `/langfuse/mcp` route is now a per-tool allowlist.
- **Outcome, measured by:** a test proves no `tenant_content` operation is reachable from the knowledge door or an external agent client.

### S5 Data-flow register
- **Design suggests:** `configs/subprocessors/*.yaml` as the one register; the legal page generated from it; a test that fails when a `*_BASE_URL`, `*_API_KEY`, `*_HOST` or Hog destination has no row. Adds the flows found in review: PostHog Support tickets (feedback text and email), the Slack alert with message text (strip it or register Slack), ElevenLabs dictation, and the latent vendors Modal, Serper, Jina and W&B (boot assertion unless registered). PostHog redaction of content.
- **Fixed, ownership:** `configs/subprocessors/`, `bff/legal/content/`, `deploy/posthog/support/`, boot assertions, `docs/compliance/`.
- **Outcome, measured by:** the ratchet test green, including a positive control that plants an unregistered flow; the check also finds outbound integrations that use a literal endpoint or an SDK's default host, not only named variables; the legal page lists every flow.

### S6 Connector types
- **Fixed, safety:** the fetcher rejects internal, link-local, cluster and cloud-metadata addresses after DNS resolution, on every connection and every redirect hop, and dials the address it checked (no second lookup, so DNS rebinding cannot pass), with tests for each, a redirect and a rebinding answer included, before any source test is enabled. As built: `PublicOnlyBackend` and `guarded_client` in `packages/public-sources/src/egress.py`, `test_egress.py`.
- **Design suggests:** `packages/public-sources/` with access types `rest`, `http_eli`, `web_document` and engines `ris_xml`, `akn`, `html_statute`; a sandboxed fetcher Deployment with its NetworkPolicy; the RIS adapter re-expressed as one configured `rest` + `ris_xml` source behind `sourceRouting`, with the nine `_FEDERAL_STATE_PARAMS` moved into config.
- **Fixed, ownership:** `packages/public-sources/` (new), `packages/ris-adapter/`, the fetcher Pulumi resource.
- **Outcome, measured by:** the Austrian answer suite unchanged with `sourceRouting` on; `task pkg:test` green.

### Wave 1 additions (sent to the running sessions on 2026-11-10)
- **S1:** the stubs above; `consumers.ts` with `knowledge-consumers.spec.ts`, and `wire/vocab.ts` with its generator, so record words have one source.
- **S2:** render the office answer label; the door's cumulative quote cap per document and session (E19); refuse a web search that shares a shingle with licensed text; the multilingual quoting rule; no groundedness judge on licensed turns; the lessons distiller refuses turns that used office or licensed text (E44), detected from S2's own seam markers until S15's `message_edition_uses` exists.
- **S3:** komoot off by default; the remaining Austria-only prompts and derivations (`parcel_note` without a country, project-experience prompts "in Austria", the deep-research opener "Austrian office", `prompt-view.ts` deriving `country=at`); `time_zone` replacing `OFFICE_TIME_ZONE`. Prepare the neutral static prompt push, and gate it on S8's renderer being deployed.
- **S4:** the right to edit `exposure.config.ts`; the T-row "door honours it" is met by restricted folders (ADR-0097), which the office door already honours because it runs every route as the person (`read-gate.integration.spec.ts`); correct `docs/architecture/agent-surface.md` where it describes the platform door.
- **S5:** the DPA annex generated from the register; the corrected "excerpt" copy on the legal page; the interim FAQ correction (design 1.3: no claim of Germany or of older versions) as static wording until S15 generates the FAQ.
- **S6:** the AKN `eId` anchor fixture test.

## Wave 2


### S7 Platform records, review, publish
- **Design suggests:** v7 4.4. Change requests, per-claim review, approvals with the person's yes, preview and stable channels, golden runs, rollback, the validation kit; territory import; AT authorities; the text-less `std-asi` listing of the ÖNORMs OIB cites; the platform view (countries, coverage, queue).
- **Fixed, ownership:** `bff/base-knowledge/platform/`, `catalog/platform-knowledge.ts`, the platform UI area, a migration (next free number).
- **Also (coverage):** `organization_countries` and the entitlements view with `platform-org-country-entitle`, `organization-countries-get`, `platform-organization-home-country-set`; indexing on publish (a Hatchet job per manifestation), `index-status`, re-ingest rebinding; platform freshness targets (14, 30, 90 days); `platform-norm-registry-update` answering 409; the reusable `personDecides` primitive.
- **Outcome, measured by:** a rollback round trip; MA 37 excluded for a project in Graz; a published platform text is searchable within the indexing job's run.

### S13 Rulesets and the one evaluator
- **Design suggests:** v7 3.7. A ruleset record type; `decision_table.v1` as Zod; one JsonLogic evaluator with a library oracle and property tests; competence rulesets with the open-node rule.
- **Why:** setup facts (S9), reference dates (S11), competence and a country's advice policy are all rulesets. Without one evaluator each becomes code per country again.
- **Fixed, ownership:** the evaluator package, the ruleset tables (a migration, next free number), its ADR.
- **Outcome, measured by:** OIB classification expressed as a ruleset reproduces today's results on the fixtures; competence proven on synthetic territories and authorities (E32: Berlin-Mitte, Hamburg-Altona → Bezirksamt), since the real territories and authorities arrive with S7 in parallel. S8 loads Austria's real competence rulesets.

### S14a AI Act marking (starts now)
- **Fixed, deadline:** AI Act Art. 50 marking of generated content and the disclosure on letters to authorities, live by 2026-12-02 (design 6.7). It needs no other session.
- **Outcome, measured by:** marking present on every generated document and letter, with a test per output path.

### S14 Residency
- **Design suggests:** v7 6.4 – 6.7 (B3). The per-role processing table; EU routing; `processing_location` and `subprocessor` on every generation; the ZDR org switch that today turns off; BYOK held to the EU; `organization_processing_policies` with `purpose_ok` and the include-only judge filter; WorkOS audit events with salted hashes instead of filenames; staff break-glass; the `residency_cell` boot check.
- **Outcome, measured by:** `processing_location_compliant` on every generation; a planted non-EU route fails the boot check; trace metadata `cell` and `purpose_ok` set.


## Wave 3

### S8 Austria as pack 1
- **Design suggests:** OIB adoption per Land as relations; roles replace `citations/binding.py`; chain text replaces the static `<building_law>` block; Qdrant payload gains `edition_id`, `work_id`, `territory_ids`.
- **Outcome, measured by:** v7 8.3. Byte-identical prompt blocks where nothing should change, identical top-k through an id map, paired answer-suite runs with an allowlist.
- **Fixed, ownership:** `citations/binding.py`, prompt rendering of the chain, the knowledge-layer payload, a migration (next free number).
- **Also (coverage):** defects 6 and 7; relation records with `deviates_from` substitution and the precedence merge; every kind in the CHECK with fixtures; cross-pack resolution; the `eu` pack with dated union parents (E38, E39). Unblocks S3's static prompt push.

### S9 Setup facts as data
- **Design suggests:** `fact_definitions` and `fact_sources` per country as records; the intake stages read them instead of TypeScript options; a parity harness for `location-register.ts` and `derivations.ts`.
- **Why:** this is the last per-country code (review finding); setup is going agentic (ticket 31).
- **Fixed, ownership:** `bff/project-profile/intake-stages/`, `location-register.ts`, `derivations.ts`, `bim/rules.ts`, a migration (next free number).
- **Also (coverage):** defect 5 (`withDerivedClass`); `classification-evaluate` on S13's evaluator with the existing-versus-planned delta (E34); the stale ticket-26 references.
- **Outcome, measured by:** zero diffs on Austrian profiles and fixtures; DE and CH fixtures with distinct synthetic setup records show that each project receives only its own country's options.


### S10 Agent-grade door
- **Design suggests:** v7 4.3. The onboarding guide resource, `schema-get`, idempotency keys, batches of 200, `dryRun`, RFC 9457 problems, citation capture, the quote-span check for every proposer, `personDecides` on approve, publish, rollback and entitlement; `onboarding-door.spec.ts`, a scripted client with no model.
- **Also (from S4, 2026-11-10):** `platform-skill-create` and `-update` are still on the door and publish instructions to every office; put them behind `personDecides` or withhold them. S4 took ADR-0158 for the door split, so the design's "a country is a data release" ADR takes the next free number.
- **Outcome, measured by:** Claude takes AT-9 to a green validation using door operations only.

### S11 Time and editions (ticket 30)
- **Design suggests:** procedures, per-jurisdiction reference-date rules, transitions, `asOf` on search and `law-lookup`.
- **Also (coverage):** reference-date rules run on S13's evaluator; consolidated versions by `FassungVom`; edition minting with `historyAvailableFrom`.
- **Outcome, measured by:** "what applied at submission" answered with the edition named, on a fixed as-of set.

### S12 Address resolution
- **Design suggests:** `site-resolve` and `project-site-set` over official registers hosted in the cell (BEV first), replacing the withheld `address-search`.
- **Outcome, measured by:** a typed address resolves as `unverified`; a register hit gives country, Land, Gemeinde and the authority.

## Wave 4

### S15 Turn context and gate
- **Design suggests:** v7 4.6 and 5.5. `/api/internal/turn-context` with the full `KnowledgeContext`; `RequestContext` gains jurisdiction, procedures and gate; the gate (`organization_unplaced`, `not_entitled`, coverage levels L0 – L2); coverage labels and freshness degradation; `site_unknown`; pinned pack sequences for a running research turn (E42); `message_edition_uses` (E25); the `knowledge_unavailable` alert; `coverage-get`, `base-knowledge-report`, `project-base-get` and `-confirm`; the intake's backend tools; the FAQ generated from coverage, checked by `check_coverage_copy.py`. Flag `knowledgeContext`.
- **Why:** this is where an answer learns which country, edition and coverage apply. Without it the records exist and the agent does not read them.
- **Also (coverage):** `project-base-confirm` is the Steckbrief confirmation, built here; `evals/base-knowledge/edge_cases.yaml` with the E-fixtures; trace metadata `jurisdiction_chains`, `gate`, `coverage`, `pack_seqs`, `stichtage`.
- **Also (from the Wave 2 and 3 audits):** the shared corpus carries no country yet. Give its chunks `country_id` and filter `knowledge_search` by the office's entitlement, so an office not entitled to a country reads none of its corpus; a rollback of a country de-indexes its chunks (audit of #1559, item 1, and S7). Corpus rows and `oib_sync`'s ingest job carry no `edition_id`, so `knowledge_search` cannot answer `asOf` from the corpus, and a mark set on a base-corpus file is lost on re-ingest (S8, S11; gotchas row "A mark you set on a base-corpus file's points"). Give the corpus row and its ingest job `edition_id`, then answer `asOf` from it.
- **Outcome, measured by:** E01, E02, E04, E28, E40 on fixtures; the `knowledge` phase within its p95 budget; a test that plants two organizations with equal digests and gets two cache keys.

### Wave 5: cut-over (added 2026-11-10)

**Dev is the playground (the user, 2026-11-10).** On the dev stack every switch is on for every organization, and a merge to `develop` deploys there in about ten minutes, so a slice is merged as soon as it is green and reviewed, then checked live on dev. Production is never touched by a session, not even read: it gets its own release, in the order below.

Waves 1 to 4 built every new path beside the old one, behind a switch whose off state was byte-identical to before. The design says the new paths *replace* the old (the role engine replaces `citations/binding.py`, the chain text replaces the static `<building_law>` block), and no session was planned to delete the old ones; the user's goal was the old paths gone. Wave 5 does that. The data still enters only through `records-propose` (no seed path, design 7), so the order is fixed:

1. **Production release of develop as it stands**: switches off, and the platform door exists in production. Not every change is behind a switch, so two things a person notices change with it, and the release names them: address search in the project dialog is off unless the stack sets `geocoderUrl` (S3, ADR-0159; recovery: set it, or `GEOCODER_URL` in Compose, and redeploy), and the platform door no longer offers the 18 tenant-content operations, the cross-office conversation and feedback reads among them (S4, #1548; platform staff keep them in the console in the browser, and there is no switch back by design).
2. **Austria onto staging, then production**, through the platform door: an operator's agent proposes `eu.json` and `at.json` with captured sources (KC-6), a domain expert and a second approver approve, preview, stable. AT's coverage level core.
3. **R1 and R2 merge** once staging has the data and the answer suite passes with the new path on; production gets them in the release after step 2 reached production. Merging them earlier leaves an environment with no Austrian law at all.

| Session | Takes out | Contract |
|---|---|---|
| R1 agent | `citations/binding.py` and its host regex (callers move to `citations/roles.py`), `knowledge-layer/chat_binding.py`, the static `<building_law>` block (`chat_static.md`, `prompt.py`, `norm_registry.py`) and `test_static_prompt_split.py`'s byte pin, `common/applicability.py`, the Austria defaults in `agent/common` and `agent/citations`, every fallback taken when the turn has no knowledge context | With no context the agent fails closed: no verdict, no edition named binding, the gate's note. The corpus backfill (`LEGACY_CORPUS_COUNTRY`, `backfill_legacy_marks`) stays until it has run in production |
| R2 workspace | The switches `knowledge-context`, `building-law-chain`, `time-editions` and the branches they choose between; `bff/oib/applicable-standards.ts` and its UI, `base-knowledge/platform/applicability.ts` where the rulesets replace it, the Austria lists in intake and project setup | The BFF sends the knowledge context on every turn; who reads which country is the entitlement rows (`knowledge_country_entitled`), never a WorkOS switch. Writes ADR-0175 (the cut-over), amends the flag-off sentences of ADR-0158 to 0174 |

Kept as switches, because they gate data or a contract that does not exist yet rather than an old path: `site-resolution` (the BEV import), `source-monitors`, the residency switches (the EU contract). `office-base-knowledge`, `licensed-seam`, `source-routing` and `platform-base-knowledge` are rollout switches for capabilities with no old twin; R2 lists each with a keep-or-remove reason in ADR-0175.

### After Wave 5: sessions

Sessions that started during Wave 5 or after it. Each takes the next free migration and ADR number when it merges.

- **S17**: a PDF as a public source (#1580), and the guarded RIS client (#1583). Next: PDFs parsed in the fetcher pod, one list of source formats, one source registry, OIB as a fetched source, and the monitor fixes.
- **S18**: approve-alone (#1579) and the org-countries list (#1585). Next: four eyes held by the database, the source check on overrides, approve-alone simplified, preview deleted, knowledge permissions, and the home country in one store.
- **R1 / R2**: the Wave 5 cut-over (#1582, #1578, #1584). They also take the contract findings from the architecture review (one turn payload, identifiers on the work, structured `sourceRefs`, schema parity) and building applicability (#1589).
- **Q1 / Q2**: slices Q1 (prefix caching) and Q2 (the Austrian golden set, #1588) of [`quality-and-cost.md`](quality-and-cost.md).
- **M1**: one law model. That covers in-force resolution and the reference date, site placement, limits, visibility, territory parents, competence, and country tables as data.

**Architecture review after Wave 5:** the ranked findings and who owns each are in [`architecture-review-2026-11.md`](architecture-review-2026-11.md).

#### Where the build stopped (2026-11-10, 21:35 UTC)

Merged on develop: #1593 (one visibility predicate), #1592 (PDFs parsed only in the fetcher pod), #1591 (half-open edition intervals, migration 0217), #1598 (a monitor keeps its page under review while its request is open), #1594 (four eyes in the database and the split knowledge permissions, migration 0218), #1584 (one turn payload: uses carry text, designation and structured `sourceRefs`; identifiers on works), #1600 (source-status lists the built-in sources beside the records), #1601 (the fetcher's egress policy without the IPv4-mapped range), #1597 (one `parents` field per territory, one walk, migration 0219), #1582 (the knowledge context is the only source of which law applies; the Wave 5 cut-over is complete).

**Dev deploys failed from #1592 to #1601** (20:10 to about 20:45 UTC): the fetcher's NetworkPolicy listed `::ffff:0:0/96` under `::/0`, which the API server refuses. Nothing merged in that window reached dev until #1601. The deploy runs after a develop CI run finishes green, and deploys that run's commit. A run in progress is never cancelled; a newer push only replaces a run still queued. So during a merge burst, dev can receive an earlier commit first (the 20:51 deploy checked out `af3da8c88`, from before #1601, and failed again), and the latest merge arrives with the next green run. After a merge, check the deploy run, not only CI (gotchas row).

**Dev regressed until Austria is published.** With every switch on and no Austrian records released, `coverage-get` answers AT at level `none`, the law gate withholds the RIS tools, and a question like "Was sagt § 50 Wiener Garagengesetz?" answers from web search at low confidence (12.7 s, high, RIS before; 58.7 s, low, web after). Publishing EU then AT is the first job of the next session, not a nicety.

**Publishing Austria on dev, where it stands.**
- Change requests `c323cdc4-b258-4176-b5ce-4eaca8b51b5a` (EU, submitted) and `5907f5cb-8443-43bd-8b82-02f28d563dfd` (AT, draft, 202 records, validates clean).
- The AT draft carries the RIS dates (half-open `validFrom`/`validTo`): Salzburg's OIB 2023 relations from 2026-09-01 (§ 9 Abs 1 LGBl 83/2026) with the 2019 ones ending there, OIB-RL 6 März 2015 as an edition with an AT-5 `makes_binding` relation from 2026-09-01; Burgenland RL 6 2025 from 2026-11-05 and RL 6 2019 ending there; Niederösterreich's 2023 relations from 2025-03-20 and the 2019 ones ending there. Wien unchanged.
- The approval is the owner's own: `platform-knowledge-change-request-decide` with `override` asks the person through the door, and an agent cannot answer it. Since #1594 an approval alone also needs every cited capture fetched or source-checked; the AT draft has one `operator_supplied` capture (`b22f63d5-6ac7-43d8-b138-ac51a2c0b855`, the RL 6 2015 masthead), which blocks it until a second person checks it. Where the masthead can be fetched, re-propose the record citing a fetched capture instead: the check reads only each record's newest revision (migration 0218), so the superseded pasted citation no longer blocks. Dropping the record is the last resort.
- Still missing: work identifiers (`ris_gesetzesnummer`, `eli` ending in "/") on the Bauordnungen, the 2019 OIB texts in the corpus (11 PDFs), entitling the dev offices.
- There is no per-record read of a draft: `change-request-get` truncates at 40k characters (reported as a missing operation).

**Open PRs.** Each takes the next free migration number when it merges (develop is at 0219).

| PR | Owner | State at stop | What it needs |
|---|---|---|---|
| #1599 prefix caching and token budget | Q1 | reviewed, fixes in | the answer suite (blocked on OpenRouter credit), renumber; watch items in its body; `chat_static.md:6` is incomplete and needs `prompts:push -- --apply` |
| #1589 applicability per building | R2 | deferred, handover in its body | merge develop (it is behind #1584), gates, captures, `at-scopes.json` proposed on dev |

**Branches without a PR.** `m1/competence-directives` (finding 14, competence decides directives): resolver side done, handover in `docs/design/international/handover-competence-directives.md` on that branch. The office half is decided (option A: an unlinked addressee answers `authority_unknown`, no prefix fallback).

**Next, per owner.**
- **S18 (governance):** PR B, findings 3, 4 and 11: delete the preview channel (code, the `knowledge_release_moves.channel` CHECK and the 0212/0214 guards, a down that restores the CHECK `NOT VALID`), approve-alone as derived state with `allowedActions` on the read, ADR-0176 rewritten. Then PR C, finding 16: the organizations row written on WorkOS `organization.created`, idempotent. Known limits left by design: "every claim accepted" is checked in the service only; revisions proposed in one transaction share `created_at`, so "newest" falls to `revision_id` order.
- **S17 (sources):** the OIB capture check end to end, monitor 5b (`text_sha256`) and 5c (state per manifestation, size it first), `platform-knowledge-document-import` (a URL fetched through the capture route's guarded fetch, then the existing upload service), and the failure path in `monitor.ts` (~218) still writing `ok_at` from the snapshot.
- **R1 (agent):** a test that fails when `textOf` (`context/resolve.ts:193`) stops calling `capText`: about 300 territory-binding works for one leaf in `edge-cases.spec.ts`, resolved, the text at most 16 000 characters and ending with the cut note.
- **Unowned:** delete the site-resolution "alone and first" block in `scripts/rls-test-db.sh` (#1593 fixed the cause; prove it with one full run); `platform-cards.spec.tsx:81` (`/Treppenlauf/`) fails on develop in every local run; the gotchas env-leak row has no established cause.
- **Retired WorkOS switches to delete** once #1582 and #1584 are deployed on dev: `knowledge-context`, `building-law-chain`, `time-editions`, `office-base-knowledge`, `platform-base-knowledge`, and `source-routing` (since #1592).
- **The owner:** OpenRouter credit for the answer suite; `prompts:push -- --apply` and `langfuse:provision -- --apply`; sign in again on dev after #1594 (new permissions); the approval alone of EU and AT.

**After Wave 5:** answer quality and cost, measured against the market and current vendor guidance, continue in [`quality-and-cost.md`](quality-and-cost.md) (slices Q1–Q4).

### S16 Onboarding tooling
- **Scope (2026-11-10):** country onboarding itself, Germany first, is run elsewhere. S16 builds only the country-neutral tooling it needs.
- **Design suggests:** the advice-policy and terminology ruleset *types* with hedge templates and the `advice_policy_held` score (the content of a country's policy is that country's onboarding); the `ogc` access type; `source-test`, `source-status` and `source-credential-set` on the door; monitors (`changes_since` opening change requests, the terms hash, `freshness_lag_days`); the test-host and database-host allowlist; the privacy reviewer for site points.
- **Outcome, measured by:** a scripted onboarding on preview with a synthetic country (a fixture territory, one configured source, one advice policy) reaches a green validation, with a monitor opening a change request when the source changes.

## Not in this build
Each returns when its trigger arrives, as its own session.
- Default-deny egress for every workload, the data-class inventory, and export, erasure, backups and retention across all stores.
- Office region packs; office records proposed to or contributed into the platform (E43, E45); `arcgis_rest`; `location-lookup`.
- The contract step that drops `norm_registry` and `oib_knowledge` (after S8 has run in production).
- `SourceKind` `base_knowledge`, labels read from records and `at-only-terms.spec.ts`; the rest of ticket 31 (authority chain, classification shift, agentic intake; the Steckbrief confirmation itself is S15's). Trigger: the agentic project-setup track.
- The alias map (E29). Trigger: a source changes its format.
- Switzerland's LexFind connector; DPIA and TIA templates (documents, not code).
- **Onboarding a country, Germany first** (decided 2026-11-10: run elsewhere, not in this build): the German advice policy and counsel's sign-off, the 16-portal classification and terms check, German Länder competence rulesets, a German address register (E31), and the L0 operation itself.
- An office-set "not for agents" flag on folders or documents (design 6.5 names an "exclusion list" but never defines it; nothing in the code is one). Open product decision for the user: granularity, who sets it, and whether the product's own agent counts. Today restricted folders are the mechanism.

## Merging a wave

The user delegated the Wave 1 merge (2026-11-10): the orchestrator merges the whole wave in one pass once every PR is green and reviewed against its intent. A merge into `develop` deploys the `dev` stack (`.github/workflows/deploy.yml`), and its migrate Job applies new migrations to the dev database, so the chain must be right before the first merge.

1. **Review every PR once** (the user's rule, 2026-11-10): one independent reviewer per PR, one pass, no second round. It checks the PR against its outcome and against the recurring findings: fails open on unknown, tenant isolation, flag off unchanged, writes need the person's yes, tests that fail on revert, safe migrations, licensed text kept out. The session fixes what it finds, and the PR merges when CI OK is green without another review. Read "Better than the brief" and "Changes to fixed points" and reconcile them.
2. **Integrate once.** On a scratch branch from the latest `develop`, merge every PR of the wave in the merge order. Migrations live in `apps/workspace/migrations` with a Drizzle journal (`meta/_journal.json`); git merges two appended journal entries silently, so two PRs that took the same next number collide without a conflict (gotchas: "`git merge` … `_journal.json`"). Renumber in merge order: file names, `idx`, a `when` after the previous entry, and every reference (`scripts/rls-test-db.sh` block, specs, `docs/database/schema.md`, comments). ADR numbers likewise (`scripts/check_adrs.py --next`).
3. **Prove the chain** on the integration branch: `bunx vitest run tests/db/migrations-journal.test.ts` in `apps/workspace`, `task db:test:rls`, `task pkg:test`, `task verify:fast`.
4. **Carry the renumbering back** to each PR branch, in its own commit, so each squash-merged PR is the code that was proven. Merge in the order the chain was numbered; after each merge, update the next branch from `develop` and wait for green before merging it.
5. **Stacked follow-ups** merge right after the PRs they sit on. Wave 1 has one: `claude/intl-licensed-door-cut` (S2's cut on the door's `document-text-get`, using S1's `licenceOfDocument`), based on S1's branch, merged after #1547 and #1551 and before `officeGrundlagen` or `licensedSeam` is turned on anywhere.
6. **Watch the dev deploy** of the last merge: the migrate Job completes, and nothing ask-first ran (the static prompt push, the authz catalog apply and Langfuse provisioning stay with the user).

### What the Wave 1 merge taught (2026-11-10)
- **Reserve ADR numbers in the brief, not migration numbers.** "Next free number" made six PRs claim migration 0200 and ADR-0158, and renumbering by hand cost an hour. ADR numbers may have gaps, so each brief reserves one (Wave 2: S7 0165, S13 0166, S14 0167). Migration numbers may not: `tests/db/migrations-journal.test.ts` requires idx = file prefix with no gaps, so a reserved 0205 fails while 0203 and 0204 are not on develop (#1558). A session keeps its migration in one file pair, treats the number as provisional, and takes the next free number when it merges develop just before merging.
- **The ADR index collides even with distinct numbers** when two PRs insert rows at the same spot, so the second needs develop merged in again and another CI run. Merge PRs whose rows are far apart back to back; serialise the rest.
- **Merging PRs one by one without the integration build broke develop.** #1545 made `OrgSettings.homeCountry` required and #1555 added a mock without it; each was green alone. Run the combined type check (`bun check`) on develop plus every PR about to merge before the first merge.
- **A PR stacked on a squash-merged branch** conflicts on every file the parent touched. Do not rebase or force-push: build develop plus the child's own diff (from its merge base with the parent) and record it as a merge commit on the child (#1554, `e8ccc1213`).
- **Develop's queued CI run is replaced by every following merge** (and by the release-notes commit each merge triggers); a run already in progress finishes. So the dev deploy, which follows a green run, lands the commits of a merge burst in steps, and the last merge's migrate Job waits until merges pause (`concurrency` in `.github/workflows/ci.yml`).
- **Merging needs no approval from another person:** develop's ruleset asks for one approving review, which the owner's merge bypasses; CI OK is the gate, and branches need not be up to date.

## Human steps on the critical path
1. Merge order: contract, then Wave 1 in any order; S1 before S7 and S13, S2 and S5 before S14; S7 and S13 before Wave 3; S8, S9, S11 and S12 before S15; S6, S7, S10 and S13 before S16; then Wave 5 in its own order (Austria's data on staging and production before R1 and R2). S14a merges whenever it is green. Wave 1 is merged by the orchestrator (above).
2. Approve the ask-first steps each session prepares.
3. Counsel for the German advice policy; an expert for anything past L0.

## Session brief template

```
You are building one part of the country base knowledge foundation for the {productName} workspace.

Outcome: <what is true for a person or the system when you are done, in one or two sentences>.
Why it matters: <the user value or risk behind it>.

Fixed (others depend on these; change one only by flagging it in your PR first):
- <interfaces: the record shape and values named here, your flag name, the files you own; take the next free migration number>
- Safety: tenant isolation, licensed text stays inside its seam, the person confirms publish; never run `-- --apply` or a migration against a shared database.

Design suggests (not binding; beat it if you can): <the design's approach, with pointers to design/v7.md sections>.

You decide how. Read the code, question the suggestion, prefer the simpler design, reuse what exists, and follow the repo's AGENTS.md.

Scout with Haiku subagents: send several in parallel, each with one narrow question (where does X live, who calls Y, what does test Z assert), and keep your own context for design and code. Re-check a scout's fact before you rely on it.
Push to your branch after every green slice; you can be stopped at any moment, and unpushed work is lost.

Branch claude/intl-<slug>, based on develop; PR into develop. Read the design with: git fetch origin claude/intl-design && git show origin/claude/intl-design:docs/design/international/design.md
Gates: task verify:fast; plus <db:test:rls | pkg:test | be:eval:answer-suite before and after> where your change needs it.
Finish by opening the PR with: a Conventional title; the definition-of-done checklist with evidence; "Better than the brief" (what you did differently and why, or "none"); "Changes to fixed points" (or "none").
```

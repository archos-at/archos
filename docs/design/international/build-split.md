# Country base knowledge: the build, split across parallel sessions

Source: design v7 (`docs/design/international/design.md` on branch `claude/intl-design`, Part I) plus the v7 review findings. Updated 2026-11-06 against `develop` at `cae35262`.

**What changed since the design was checked (`4fb7b836`):** 39 commits. Migrations now run to 0199 and ADRs to 0157, so no numbers are reserved here: each session takes the next free number and the orchestrator renumbers at merge. ADR-0154 put platform staff's MCP traffic through agentgateway, and #1518 admits platform staff whatever organization they signed in with; the cross-office conversation and feedback operations are still on the platform door (`exposure.config.ts:443-472`), so S4 matters more, and must cover the gateway. Project mail landed (inbound mail, in-cluster ClamAV, ADR-0157): a new flow for S5. Ticket 32 is still "Neu". feld72 already uses Claude over MCP to sort its office knowledge, which supports "Claude is the onboarding agent".

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
- **A thin contract, as text.** Only S2 depends on S1's tables, so there is no code contract to wait for. The shared points (record shape, licence values, flag names, file ownership) are written in each brief, and S1 owns the tables. Wave 0 is only the design on a branch every session can read. A session that finds a better shape proposes it in its PR, and the orchestrator reconciles.
- **The orchestrator** spawns sessions, watches them (`get_session`, `list_events`), reviews each PR against its intent (not against the suggestions) with an independent reviewer, carries good deviations to dependent sessions, fixes the stacking order and rebases. Cloud sessions cannot message back, so each session finishes by opening its PR with the sections the orchestrator reads.
- **Gates in every session:** `task verify:fast`, plus `task db:test:rls` for a tenant-boundary change, `task pkg:test` for `packages/`, and `task be:eval:answer-suite` before and after anything that shapes answers, with the report in the PR. Conventional PR title, a release note per slug, and the definition-of-done checklist.
- **Ask-first steps stay with a person:** `task prompts:push -- --apply`, `task workspace:provision:authz -- --apply`, migrations against a shared database, and Langfuse provisioning. Sessions prepare them and stop.

## Waves

| Wave | Sessions in parallel | Starts when | Rough wall clock |
|---|---|---|---|
| 0 | the orchestrator alone: the design on `claude/intl-design` | now | minutes |
| 1 | S1 Office layer · S2 Licensed seam · S3 Correctness · S4 Door split · S5 Data-flow register · S6 Connector types | design branch pushed | 3 – 5 h |
| 2 | S7 Platform records and review · S8 Austria as pack 1 · S9 Setup facts as data | S1 merged | 4 – 6 h |
| 3 | S10 Agent-grade door · S11 Time and editions · S12 Address resolution | S7 merged | 3 – 5 h |
| then | Germany at L0: an operator's Claude session onboards it **through the door**, no code | S10 merged, counsel sign-off | review time |

About 1 – 2 days of wall clock for the code if PRs are merged as they turn green. Your review and merge sit on the critical path, not the writing.

```
W0 contract ─┬─ S1 office layer ─┬─ S7 platform records + review ─┬─ S10 agent-grade door ── Germany L0 (operation run)
             ├─ S2 licensed seam │                                ├─ S11 time and editions
             ├─ S3 correctness   ├─ S8 Austria as pack 1           └─ S12 address resolution
             ├─ S4 door split    └─ S9 setup facts as data
             ├─ S5 data-flow register
             └─ S6 connector types
```

## Wave 0: the shared points (text, not code)

The design, the codebase map and this split are on branch `claude/intl-design` under `docs/design/international/`. These are the only points sessions share; everything else is theirs to decide.

- **Record shape (S1 owns the tables).** One set of tables for platform and office knowledge, told apart by an owner column (`organization_id`, NULL for platform). Works, editions and manifestations (design 3.4); append-only revisions; a "last checked" record. Platform rows can arrive later as additions, with no data migration.
- **Licence values** S2 keys on: `public_open`, `public_restricted`, `licensed`. Licensed text is marked on its search-index points (S1 writes the mark, S2 enforces it at the model seam).
- **Owner filter in search:** a mandatory office filter on tenant scopes (S1 adds it; everyone else reads through it).
- **Flags,** default off: `officeGrundlagen` (S1), `licensedSeam` (S2), `knowledgeDoor` (S4), `sourceRouting` (S6), `knowledgeContext` (later).
- **Files nobody but the orchestrator edits during Wave 1:** `apps/workspace/bff/agent-api/exposure.config.ts` and `catalog/platform.ts` are over the 600-line limit. New operations go in new files (`catalog/base-knowledge.ts`, `exposure/<area>.ts`) with a one-line spread; the session adding the first one makes the spread.
- **Numbers:** the next free migration and ADR number at the time of writing (`scripts/check_adrs.py --next`); the orchestrator renumbers on merge if two collide.

## Wave 1

### S1 Office layer (ticket 32)
- **Design suggests:** v7 8.1. Office upload, confirm, update, check, remove, search, get. Kinds `technical_standard`, `guideline`, `commentary`, `authority_directive`, `statute`. Edition from the masthead, outline, ISO territory ids, issuer and addressees with the interim authority path, the "zuletzt geprüft" marker (365 days for standards, 180 for directives), `licence_class` with metadata-only ingest, erasure with a receipt.
- **Outcome the review asked for:** office records reuse the same revision history and removal as platform records (no second lifecycle, only "confirmation moves the head"); every office work carries its standard designation (`ÖNORM B 1600:2017`) as an identifier, so a later platform listing attaches instead of duplicating.
- **Fixed, ownership:** `bff/base-knowledge/{store,office}/`, `knowledge-layer/src/vector_store/scope.py` (`ScopeRead` with a mandatory `office_id`, about 20 call sites), office UI and labels.
- **Fixed, leave to another session:** retrieval rendering and model calls (S2).
- **Outcome, measured by:** leak test with a positive control; zero residue after removal; a second office sees "gelistet, kein Text".

### S2 Licensed seam
- **Design suggests:** licensed text reaches the model only as references with a quote cap; no licensed text in traces, caches or checkpoints (`_observed_vlm_call` writes full vision messages today); extraction eval on feld72's norms.
- **Fixed, ownership:** `common/openrouter.py`, `vision_calls.py`, the retrieval-to-prompt rendering path, the eval fixture.
- **Outcome, measured by:** an untraced test and an ordering test green; feld72's case answers from its own copy behind `licensedSeam`.

### S3 Correctness and the organization flag
- **Design suggests:** v7 defects 1 – 8 (`resolve_country`, OIB verdicts outside Austria, `country=at` and confirmed typed addresses in `intake-seed.ts`, Vienna laws in every Land in `applicability.py`, OIB classes for every project, permit extraction, the Fluchtniveau question); organization rows backfilled with a home country; DE sensitive-data detectors via `stdnum`; geocoder default off.
- **Fixed, ownership:** `intake-seed.ts`, `country_profile.py`, `project_context.py`, `common/applicability.py`, `permit_extraction.py`, the intake prompt, migration 0194, the geocoder default in Pulumi config.
- **Fixed, safety:** prepares, does not run the country-neutral static prompt push (ask first).
- **Outcome, measured by:** DE and CH fixtures produce no OIB fact, rule or doctrine; every WorkOS organization has a row; answer suite before and after, with an allowlist of expected diffs.

### S4 Door split (security)
- **Design suggests:** a separate knowledge door (`/api/platform/knowledge/mcp`), or a server-side tool allowlist per OAuth client; every platform operation classified `platform_public` or `tenant_content`; tenant-content operations withheld from any external agent client.
- **Why:** the platform door today also serves cross-office conversation search and feedback (`exposure.config.ts:651-690`), and WorkOS cannot narrow a token. Claude onboarding a country must never see tenant text.
- **Fixed, ownership:** `agent-api/door/`, `door-principal.ts`, the MCP server routing, a new exposure test.
- **Outcome, measured by:** a test proves no `tenant_content` operation is reachable from the knowledge door or an external agent client.

### S5 Data-flow register
- **Design suggests:** `configs/subprocessors/*.yaml` as the one register; the legal page generated from it; a test that fails when a `*_BASE_URL`, `*_API_KEY`, `*_HOST` or Hog destination has no row. Adds the flows found in review: PostHog Support tickets (feedback text and email), the Slack alert with message text (strip it or register Slack), ElevenLabs dictation, and the latent vendors Modal, Serper, Jina and W&B (boot assertion unless registered). PostHog redaction of content.
- **Fixed, ownership:** `configs/subprocessors/`, `bff/legal/content/`, `deploy/posthog/support/`, boot assertions, `docs/compliance/`.
- **Outcome, measured by:** the ratchet test green; the legal page lists every flow.

### S6 Connector types
- **Design suggests:** `packages/public-sources/` with access types `rest`, `http_eli`, `web_document` and engines `ris_xml`, `akn`, `html_statute`; a sandboxed fetcher Deployment with its NetworkPolicy; the RIS adapter re-expressed as one configured `rest` + `ris_xml` source behind `sourceRouting`, with the nine `_FEDERAL_STATE_PARAMS` moved into config.
- **Fixed, ownership:** `packages/public-sources/` (new), `packages/ris-adapter/`, the fetcher Pulumi resource.
- **Outcome, measured by:** the Austrian answer suite unchanged with `sourceRouting` on; `task pkg:test` green.

## Wave 2 (after S1 is merged)

### S7 Platform records, review, publish
- **Design suggests:** v7 4.4. Change requests, per-claim review, approvals with the person's yes, preview and stable channels, golden runs, rollback, the validation kit; territory import; AT authorities; the text-less `std-asi` listing of the ÖNORMs OIB cites; the platform view (countries, coverage, queue).
- **Fixed, ownership:** `bff/base-knowledge/platform/`, `catalog/platform-knowledge.ts`, the platform UI area, migration 0195.
- **Outcome, measured by:** a rollback round trip; MA 37 excluded for a project in Graz.

### S8 Austria as pack 1
- **Design suggests:** OIB adoption per Land as relations; roles replace `citations/binding.py`; chain text replaces the static `<building_law>` block; Qdrant payload gains `edition_id`, `work_id`, `territory_ids`.
- **Outcome, measured by:** v7 8.3. Byte-identical prompt blocks where nothing should change, identical top-k through an id map, paired answer-suite runs with an allowlist.
- **Fixed, ownership:** `citations/binding.py`, prompt rendering of the chain, the knowledge-layer payload, migration 0196.

### S9 Setup facts as data
- **Design suggests:** `fact_definitions` and `fact_sources` per country as records; the intake stages read them instead of TypeScript options; a parity harness for `location-register.ts` and `derivations.ts`.
- **Why:** this is the last per-country code (review finding); setup is going agentic (ticket 31).
- **Fixed, ownership:** `bff/project-profile/intake-stages/`, `location-register.ts`, `derivations.ts`, migration 0197.
- **Outcome, measured by:** zero diffs on Austrian profiles and fixtures.

## Wave 3 (after S7 is merged)

### S10 Agent-grade door
- **Design suggests:** v7 4.3. The onboarding guide resource, `schema-get`, idempotency keys, batches of 200, `dryRun`, RFC 9457 problems, citation capture, the quote-span check for every proposer, `personDecides` on approve, publish, rollback and entitlement; `onboarding-door.spec.ts`, a scripted client with no model.
- **Outcome, measured by:** Claude takes AT-9 to a green validation using door operations only.

### S11 Time and editions (ticket 30)
- **Design suggests:** procedures, per-jurisdiction reference-date rules, transitions, `asOf` on search and `law-lookup`.
- **Outcome, measured by:** "what applied at submission" answered with the edition named, on a fixed as-of set.

### S12 Address resolution
- **Design suggests:** `site-resolve` and `project-site-set` over official registers hosted in the cell (BEV first), replacing the withheld `address-search`.
- **Outcome, measured by:** a typed address resolves as `unverified`; a register hit gives country, Land, Gemeinde and the authority.

## Not in this build
Default-deny egress for every workload, the privacy inventory and erasure across all stores, office region packs, location lookups, and the contract step that drops `norm_registry` and `oib_knowledge`. Each is its own later session.

## Human steps on the critical path
1. Merge order: contract, then Wave 1 in any order, then S1 before Wave 2, then S7 before Wave 3.
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

Branch claude/intl-<slug>, based on develop; PR into develop. Read the design with: git fetch origin claude/intl-design && git show origin/claude/intl-design:docs/design/international/design.md
Gates: task verify:fast; plus <db:test:rls | pkg:test | be:eval:answer-suite before and after> where your change needs it.
Finish by opening the PR with: a Conventional title; the definition-of-done checklist with evidence; "Better than the brief" (what you did differently and why, or "none"); "Changes to fixed points" (or "none").
```

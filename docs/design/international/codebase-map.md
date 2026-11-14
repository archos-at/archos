# Codebase map: jurisdiction, country base knowledge, tenancy and data location

Cartographer's consolidation of 16 scout reports, checked against the code at commit `4fb7b836` (2026-11-04, a shallow clone of 130 commits). Repo: `/home/user/archos`. Nothing in the repo was modified.

Markers:
- **[V]**: I read the cited code or doc myself in this pass.
- **[S]**: a scout's claim I did not re-check. It is plausible but unverified.
- **[C]**: I corrected a scout claim.

Severity scale for couplings (section 2):
- **S1**: a data edit or a constant.
- **S2**: code in one module.
- **S3**: crosses layers (Python and TS mirror, or schema plus prompt plus UI) or needs a migration.
- **S4**: no primitive exists. A new concept is needed, not a generalisation.

---

## 1. Overview

### 1.1 The system as it touches jurisdiction, base knowledge, tenancy and location

the agent has two halves. One is a Next.js UI plus BFF (`apps/workspace`, which owns Postgres, authz, the intake, the profile, the MCP door and the catalogue of operations). The other is a Python agent tier (`packages/agent`, `packages/knowledge-layer`, `packages/ris-adapter`, `packages/tavily-web-search`, hosted by `apps/agent-host`). Everything below assumes **one country, Austria**. The code was written that way on purpose, and it only names a seam where the second country would plug in.

**What a country is today.** A country exists in exactly one Python registry, `CountryProfile` (`packages/agent/src/agent/common/country_profile.py`). One profile is registered, `at` [V]. The project's country is a free-keyed fact in the `projects.profile` jsonb (`facts.country`). The agent recovers it by regex from the prompt text the BFF renders (`- country=<v>` under `confirmed:`). It does not arrive in a structured field: `RequestContext` carries `federal_state` but no `country` (`packages/agent/src/agent/project_context.py:462`) [V]. An organisation has no country, region, residency or timezone: no file in `apps/workspace/bff/db/schema/` contains the word "country" [V]. The office clock is the constant `OFFICE_TIME_ZONE = 'Europe/Vienna'` (`apps/workspace/bff/format.ts:328`) [V].

**Jurisdiction depth.** Two levels are modelled: country (barely) and Austrian Bundesland. The Bundesland is the token set `vienna | lower_austria | … | burgenland | outside_austria`. It is held in about six places across Python, TS and SQL; section 4 lists them. Municipality appears only as a geocoder output (`GeocodeResult.municipality`), a free-text `municipality` facet on `document_search_facets`, and two Altstadt-law entries in the location register. Nothing models the competent authority.

**Corpus, the "Normen vs. Gesetze" split as built.** Legal knowledge reaches the agent through three channels:
1. **Base corpus.** OIB-Richtlinien PDFs that an operator uploads to the platform bucket under `base-corpus/`. They are tracked in `oib_corpus_files` (no edition, validity, licence or source URL), ingested by a Hatchet job, chunked per Punkt (`CHUNK_FORMAT_VERSION = 4`), and indexed into Qdrant logical scope `oib_knowledge` inside the shared physical collection `corpus`. Every office reads it.
2. **Norm registry.** 24 curated pointers into RIS (`configs/norms/at/registry.yml`, admin store table `norm_registry` keyed by `country`), with prose `binding_note`/`review_note` and only a `verified_at` timestamp. Ranks are `federal_law | state_law | ordinance | authority_info | external_standard`. No seed entry uses `external_standard` or `authority_info` beyond one MA 37 entry [S].
3. **Live RIS adapter.** `ris_lookup` (the agent's native `law-lookup`), plus `ris_search`, `ris_fetch_document` and `ris_catalog_lookup`. Results are cached 7 days in Dragonfly (`RIS_CACHE_TTL_DAYS`, `packages/ris-adapter/src/cache.py:51`) [V].

ÖNORMs exist only as names. The prompt says their text is unavailable (`chat_static.md`, `<building_law>`) [V]. The split between norms and law shows up in only two places: the rank enum and the `binding_status` derivation in `citations/binding.py`. Austrian law forms (RIS hosts, OIB doc classes) are hard-coded there [S, partly V].

**Areas of law beyond building law.** None is modelled as a category. Everything sits in one `SourceKind` called `building_law` (label „Baurecht & Richtlinien“, `common/source_kinds.py`) [V]. Fee schedules, procurement, contract standards, professional law, site safety, subsidies and costs have **zero code presence**. "HOAI" and "Leistungsphasen" have no hits in code (scout 11). The four boolean intake triggers (Kleingarten, Denkmalschutz, Betriebsanlage, Stellplatz) are the only nod to neighbouring areas. Their hints name Vienna's laws for every Land (`common/applicability.py:77-96`) [V].

**Other country base knowledge, as it exists:**
- *Authorities:* none modelled. "Behörde" is a role word, and MA 37 appears as one `authority_info` registry entry and in prompt prose.
- *Geodata / public services:* one connector, the Photon geocoder (komoot public instance, AT-only filter). No cadastre, land register, zoning GIS, hazard, heritage register or climate-zone integration exists anywhere I or scout 16 searched.
- *Classification:* Gebäudeklasse 1-5 per OIB Begriffsbestimmungen 2023, derived in the BFF (`apps/workspace/bff/project-intake/derivations.ts`). It is mirrored as OIB-RL verdicts in Python (`common/applicability.py`) and TS (`apps/workspace/bff/oib/applicable-standards.ts`), and used again in BIM rule checks (`apps/workspace/bff/bim/rules.ts`, `profile.ts`).
- *Measurement rules:* none. The IFC engine computes net plan area and declines to name BGF (scout 13).
- *Practice models, fees, cost data, calendars, deadlines:* none.
- *Terminology:* Austrian German is fixed in the the agent voice block, „Geschoß, Stiege, Einreichung, Bauwerber“ (`chat_static.md`, `<voice>`) [V].
- *Intake lookups:* the intake definition (`projectIntakeDefinitionV1`, `version: 5`) is the register of needed facts. The **location register** (`apps/workspace/bff/project-intake/location-register.ts`) is the closest existing thing to ticket 30's "per region, decisive facts, where found, which document to request". It is data, keyed by the nine Länder, and its header says "Austria only" and that Stichtag and Standortdienste are not modelled [V].

**Tenancy.** The tenant is a WorkOS organisation id. Postgres isolation uses RLS on `organization_id = grid_current_org()` (migration 0031), which fails closed. Qdrant isolation works by logical `scope` (a collection name in a signed envelope). The indexed `office_id` field is written but **never filtered** in `vector_store/scope.py` [V]. SeaweedFS gives each org its own bucket in prod (`seaweedfsPerOrgBuckets: "true"`) [V]. Platform-wide config sits in global tables with no org column (`platform_model_defaults`, `platform_skills`, `platform_lessons`, …), read-only to tenants via `grid_secure_platform_table` [S]. Org overrides beat platform defaults, which beat YAML (model config). The norm registry follows the same idea, with an admin store taking precedence over the YAML seed.

**Data location.** One Pulumi program deploys one Kubernetes cluster (IPAX managed k0s; the repo states no physical location). Domains are `piloti.at` and `dev.piloti.at` [V]. All stores are in-cluster: CNPG Postgres, SeaweedFS, Qdrant, Dragonfly, self-hosted Langfuse and Hatchet. Data leaves the cluster on these paths: <!-- brand-history -->
- every model call (chat, embeddings, VLM, reranker, decisions) to OpenRouter (`openrouter.ai`, US) by default, or directly to an organization's own non-OpenRouter endpoint when it brings its own key (5.2, 5.4); embeddings never take the organization's key and always go to the platform's configured endpoint (`knowledge-layer/src/embedding.py`, `resolve_embed_api_key`), so document chunks reach that endpoint (OpenRouter by default) even for an office on BYOK;
- Tavily web search (US);
- keystroke address search to `photon.komoot.io`;
- identity and audit events to WorkOS (US);
- product analytics to PostHog EU Cloud;
- RIS queries to `ris.bka.gv.at`;
- nightly Velero copies by IPAX to `b101294.backupspace.at`.

Section 5 has the full map.

### 1.2 Ticket 31 (project setup) against the code as it stands

The founder names ticket 31 as a primary consumer. I fetched the ticket from Notion (page `40756a74…`, ID 31, status Neu, priority Hoch, blocked by ticket 30) and checked each "Fertig, wenn" line against the code.

| Ticket 31 line | What exists today | Gap |
|---|---|---|
| Address verified, chosen from real addresses; country, Land and Gemeinde follow; a typed address is unverified | `geocoding/photon.ts` returns `country:'at'`, `federalState` token, `municipality` and `postcode`. `intake-seed.ts:66-76` writes `site_address` with `confidence:'confirmed'` and `source:'onboarding'`, evidence `{kind:'geocoder'}` for a hit and **also `confirmed` for a typed line**, with evidence `{kind:'person'}` [V] | **Bug confirmed.** A typed address is a confirmed fact. **Second bug, not in the ticket:** `if (location \|\| federalState) facts.country = fact('at')` (line 75) writes `country=at` even when the hand-chosen token is `outside_austria` [V]. The geocoder default changed on 2026-11-03 (commit `7513296`, #1471): Pulumi now defaults `geocoderUrl` to `https://photon.komoot.io` (`deploy/pulumi/src/config.ts:575-579`) [V]. The ticket's note "no geocoder configured here" may be stale for stacks deployed after that. Whether prod has rolled out is unverified. No GKZ/AGS/BFS municipality code and no authority are produced |
| Dates captured (submitted? when? permit? project start / period); the Stichtag follows | Only a closed project carries dates: `closingIntentSchema {outcome, startedOn (month), endedOn (month)}` (`project-intake/types.ts:168-174`) [V]. The intake question types are select and boolean only. No submission date, permit date or project start for active projects. `permit_records.issued_on` exists from Bescheid extraction (scout 15) | No Stichtag concept anywhere. The location register header says the Stichtag is "deferred by the ticket" [V] |
| The agent decides transparently which date counts for the applicable law | Nothing. No transitional-provision data | S4 |
| The agent searches public location information (local rules, subsidies) and presents findings with a source for confirmation | The intake agent's tools are `intake_needs`, `record_values`, `withdraw_values`, `read_document`, `finish_intake`, `list_files`, `knowledge_search` and `read_passage`, scoped to the project's main collection (`agents/intake/prompts/system.j2`; ADR-0111) [V]. There is no web search, RIS or geocoder. `address-search` is **withheld from both the agent and external agents** (`exposure.config.ts:470-474`, `external-service`) [V] | No connector primitive. The ADR-0122 doctrine ("the door does not offer a service we only proxy, web search and geocoding") conflicts with a setup agent that has to call public location sources. That tension needs a decision |
| Classification shift between existing building and after the works is shown | `derivations.ts` derives GK per Bauwerk from inputs (`building_class@bldgN`, written only by `withDerivedClass`). Bestand keys exist (`existing_escape_level_m`, `construction_status@bldgN = existing`) (scout 06) | Two evaluations (Bestand vs Ziel) and a delta are not computed. The intake prompt says values describe the Zielzustand unless the key says Bestand [V] |
| A missing decisive fact makes the agent request exactly that document, and say why | `location-register.ts` (data: determinant, applies-when, document, reason, per-Land variant) plus the question round (`lib/question-round.ts`) and `FOUND_IN` [V header] | Exists for AT. This is the strongest seam for ticket 30's per-region fact catalogue |
| The Steckbrief names applicable rule sets **with their edition** and the project mailbox | The applicability panel (`applicable-standards.ts`) shows OIB-RL required/likely/check. The design doc says "the intake records the OIB edition the documents name (`oib_edition`)", but **no intake question or stage writes `oib_edition`**. The key exists only in `project-experience/` (closed-project fingerprint) and `legacy-names.json` [V, **[C]** against `docs/design/agentic-project-intake.md`] | No edition on anything that can be cited |
| Everything derived is sourced and confirmed before it counts as secured | `assumption` with `source: agent_suggested`, optional `evidence` (document, page, quote; geocoder; derivation; person) and `alternatives`; confirmation goes through `patchProjectProfile` (ADR-0111) | Mechanism exists. The prompt view lists every fact under `confirmed:` (`prompt-view.ts:196-203`) [V]. A fact's own confidence field is not reflected in the label the agent reads (unverified whether non-confirmed facts are excluded upstream) |
| UX lines (opens over the project, pause and resume, one action per screen) | `docs/design/project-setup-five-steps.md` stepper | Out of scope for this map |

Two stale references the ticket itself flags: `project-setup-five-steps.md` still cites archived ticket 26, and so does the `location-register.ts` header [V].

### 1.3 Tickets 30 and 32 in one line each

- **Ticket 30** asks for editions, validity periods, typed binding relations, decisive facts and the Stichtag. None of these exists in a data model. ADR-0111 itself says "the corpus holds one [edition]" [V]. The registry has `verified_at` and prose. The corpus has filename editions that are **stripped** from the family key (`clause_chunking.py:578`) [V].
- **Ticket 32** asks for an office overlay. The office shelf (`office_shelf_*`/`archiv_*` collections in physical `office`) and the `doc_class` mechanism exist. But a base-corpus `doc_class` is guessed only for base collections (`ingest/adapter.py:4285-4293`) [V]. Freshness, edition, authority scope and "fills a registry gap" do not exist. ZDR is a per-org setting only (`organizations.settings.zdrOnly`), not per document type.

---

## 2. Inventory of Austria couplings by layer

Paths are relative to `/home/user/archos`.

### 2.1 Data (YAML, JSON, seeds, migrations with content)

| # | Coupling | Path | Sev |
|---|---|---|---|
| D1 | The only country data dir: 24 RIS pointers, prose binding notes, `verified_at` | `configs/norms/at/registry.yml` [V count] | S1 to add a file, S3 in practice (see C3) |
| D2 | German-only retrieval vocabulary (`building_class` → Gebäudeklasse …) | `configs/norms/at/vocabulary.yml` | S1 |
| D3 | `exclude_file_names` lists OIB 2023 `aenderungen_*` files by name, "replaced by role/edition metadata filters in Phase 2" | `configs/config_oib_openrouter.yml:530-540` [V] | S2 |
| D4 | Corpus default `oib_knowledge`: 38 non-test files, including deploy env `COLLECTION_NAME` (`deploy/pulumi/src/app/config.ts:258`), BFF authz (`bff/proxy/collection-authz.ts:205`), job access (`apps/agent-host/.../jobs/access.py:354`), retrieval scope (`bff/retrieval-scope/collection-scope*.ts`), `vector_store/schema.py`, `country_profile.py:124`, `norm_registry.py` `NormsFile` default, `bff/norms/schemas.ts` [V] | grep | S3 (scouts said 6 sites; **[C]** it is roughly 38) |
| D5 | Land token map as SQL functions (`wien→vienna` …) | `apps/workspace/migrations/0162_permit_federal_state.sql` [S] | S3 |
| D6 | One-time Vienna backfill of `bundesland=wien` assumptions | `migrations/0018_bundesland_wien_backfill.sql` [S] | historical |
| D7 | Platform skills seeded with OIB, Wiener Bauordnung and ÖNORM text | `migrations/0053`–`0057` [S] | S1 (content) |
| D8 | Legacy name table with Austrian tokens (`"wien": "vienna"`, `oib_ausgabe → oib_edition`) | `apps/workspace/bff/project-profile/legacy-names.json` [V line 85] | S2 |
| D9 | Golden retrieval set: 52 OIB entries, `calibration_pending` | `evals/oib-retrieval/fixtures/oib_retrieval_golden.json` [S] | S3 per country |
| D10 | Dormant domain catalogue naming OIB, ÖNORM and RIS (not loaded) | `configs/domain_catalogs/deep_research_domain_catalog.yml` [S] | S1 |
| D11 | Austrian test fixtures (synthetic office, intake eval, RIS grounding) | `tests/fixtures/root_sort/austrian_office_root.json`, `tests/fixtures/intake_eval/*`, `tests/fixtures/citation_pipeline/*` [S] | S1 |
| D12 | Operator-held OIB PDFs; filename carries the edition (`_ausgabe_mai_2023`) | `data/oib/README.md`, platform bucket `base-corpus/` [S] | S3 |

### 2.2 Code logic

**Python, agent tier**

| # | Coupling | Path | Sev |
|---|---|---|---|
| C1 | `DEFAULT_COUNTRY = "at"`, the single registration, hooks bound to OIB functions | `common/country_profile.py:45, 113-135` [V] | S2 |
| C2 | `resolve_country` regex `\bcountry=([a-z]{2})\b`, default `"at"`. `country=other` does not match (no word boundary after "ot"), so the result is `at`. `country=de`/`ch` match, `get_country_profile` returns `None`, and every caller falls back to AT doctrine, AT corpus note and AT collection | `common/norm_registry.py:544-558`, callers `:589`, `:705`, `:736`; `knowledge-layer/src/search/scope.py:45-72` [V] | S2, **correctness defect today**: the intake offers `de`, `ch`, `other` |
| C3 | `load_registry` globs `*/registry.yml` and **merges every country**; `render_block_for_prompt` takes no country. The admin store is read only for `at` (`load_norms_file`) | `norm_registry.py:431-466`, `:561-578` [V] | S2 |
| C4 | `BUNDESLAENDER`, `FEDERAL_STATE_TOKENS` (with `outside_austria → None`) and the `bundesland=` legacy regex | `norm_registry.py:93-125` [V] | S3 (copies) |
| C5 | `RequestContext` federal-state whitelist `_FEDERAL_STATE_TOKENS`; unknown tokens are dropped silently | `project_context.py:192-238` [V] | S2 |
| C6 | OIB applicability verdicts (GK 1-5, Fluchtniveau bands 7/11/22, sub-codes 2.1-2.3). `render_project_block` is called **directly** by the agent (`agents/piloti/prompt.py:43, 363`) and by `render_block_for_prompt` (`norm_registry.py:713`), never through `profile.applicability`, and with **no country check**. A German project gets OIB verdicts | `common/applicability.py:252, 462-479` [V] | S3 (TS twin C17) | <!-- brand-history -->
| C7 | Trigger hints name Vienna's Kleingartengesetz and Garagengesetz for any Land | `applicability.py:77-96` [V] | S1, correctness defect for non-Vienna projects |
| C8 | `oib_doc_class` called directly by `citations/binding.py:248`, `norm_registry.py:891,1049,1312` and `knowledge-layer/.../ingest/adapter.py:1302`, so the `corpus_doc_class` hook is bypassed | [V] | S2 |
| C9 | `lane_for_hit`: hard-coded hosts `ris.bka.gv.at` and `wien.gv.at`, `"Baurecht"` fallback | `norm_registry.py:~1290-1327` [S] | S2 |
| C10 | Binding classification: RIS host regex, `ris_` tool names, OIB doc classes | `citations/binding.py:29-41, 137, 225-282` [S] | S2 |
| C11 | `parcel_note(documents)` called **without a country** by both the agent (`agents/piloti/prompt.py:499`) and the deep researcher (`agents/deep_researcher/factory.py:170`) | [V] | S1 | <!-- brand-history -->
| C12 | Permit extraction: `FederalStateToken` Literal of 9 AT values, prompt "a building project in Austria", tag `Bescheid` | `knowledge/permit_extraction.py:59, 200, 269` [V] | S2 |
| C13 | Closed-project fingerprint prompts say "in Austria" three times; `oibEdition` fact | `knowledge/project_experience.py:225, 235, 246` [V]; `bff/references/types.ts:78` [S] | S2 |
| C14 | RIS adapter: hosts, document-number grammar, ~40 OGD silos, nine `_FEDERAL_STATE_PARAMS`, `FassungVom` **only for `BrKons`** (federal), not `LrKons` (Land law) | `packages/ris-adapter/src/client.py:38-51`, `register.py:81-90, 129-166` [V for 129-166] | S2 (one adapter per source, by design) |
| C15 | Gebäudeklasse validator GK 1-5 or 0 on the BIM tool | `tools/bim/register.py:222-230` [S] | S2 |
| C16 | DXF cadastre: BEV layers, MGI EPSG 31254-31256, Grenzkataster vs Grundsteuerkataster | `drawings/dxf_source.py:57-68`, `site_ops.py` [S] | S2 per country |
| C16a | German BM25 analyser and Snowball German stemmer on all points; German umlaut folding for retrieval | `knowledge-layer/src/vector_store/schema.py:49, 166-176` [V]; `common/german_text.py` [S] | S3 (multilingual) |

**TypeScript, BFF**

| # | Coupling | Path | Sev |
|---|---|---|---|
| C17 | OIB applicability TS mirror, no country gate | `apps/workspace/bff/oib/applicable-standards.ts` (320 lines), `project-standards.ts` [V no `country`] | S3 |
| C18 | GK derivation, OIB Begriffsbestimmungen 2023 thresholds | `bff/project-intake/derivations.ts` (336 lines) [S thresholds] | S3 |
| C19 | Geocoder: `AUSTRIA_BBOX`, drops non-`AT` hits, `lang=de`, `country:'at'`; schema `country: z.literal('at')` | `bff/geocoding/photon.ts:21, 111, 127, 164-165`; `types.ts:46` [V] | S2 |
| C20 | Intake seeding hard-codes `country='at'` (also for `outside_austria`) | `bff/projects/intake-seed.ts:75` [V] | S1, defect |
| C21 | Prompt view derives `country=at` from any valid non-`outside_austria` token | `bff/project-profile/prompt-view.ts:181-193` [V] | S1 |
| C22 | Location register: `FederalState` type of 9 Länder, Austrian statute citations | `bff/project-intake/location-register.ts:35-45, 84-113` [V header and type] | S3, but data-shaped |
| C23 | BIM rule catalogue: seven OIB rules, thresholds and German strings inline in 1,550 lines; escape bands in `bim/profile.ts:44-53` | `bff/bim/rules.ts` [V size; baseline entry 1549] | S3 |
| C24 | `OFFICE_TIME_ZONE = 'Europe/Vienna'` drives calendar-day logic and scheduling | `bff/format.ts:374`, the `frist-reminder` cron in `bff/scheduling/tasks.ts` [V format.ts] | S2 |
| C25 | Pinned `de-AT`/`de-DE` number locales in about ten places | scout 10 list [S] | S1 each |
| C26 | Upload screening `at_svnr` detector (with iban, credit_card) | `bff/upload-screening/policy.ts:21` [V] | S1 per detector |
| C27 | Austrian default filing folders (Einreichung, Behörde und Bescheide …) | `bff/filing/conventions.ts:22` [S] | S1 |
| C28 | Norm admin routes and BFF service take no country (`GET/PUT/POST /v1/admin/norms`) | `apps/agent-host/src/agent_host/routes/norms.py:109-163` [V]; `bff/norms/service.ts` [S] | S2 |
| C29 | Base-corpus authority tag closed union `'OIB' \| 'RIS' \| 'ÖNORM'`; OIB doc classes with German labels | `bff/knowledge/doc-class.ts:50-55, 130-139` [S] | S2 |

### 2.3 Prompts and agent-read text

| # | Coupling | Path | Sev |
|---|---|---|---|
| P1 | The agent's `<building_law>` chain (Gesetz > Verordnung > OIB > ÖNORM > Leitfaden; MA 37; "Outside Austria … OIB and RIS do not bind: give comparative guidance") and `<voice>` ("Austrian technical German … Sie-Form", decimal comma). This repo file is the **bundled fallback**. The live text is the Langfuse prompt `piloti-system-static` (`agents/piloti/prompt.py:79-83`) [V] | `agents/piloti/prompts/chat_static.md` | S3 | <!-- brand-history -->
| P2 | `NORM_DOCTRINE` and `JURISDICTION_GROUNDING` constants (Landesbauordnung, OIB, RIS, MA 37, `wien.gv.at/flaechenwidmung`). Only the deep researcher reads them, through `doctrine_for` (`deep_researcher/factory.py:168`) | `norm_registry.py:131-200` [V partial] | S1 (already registry-overridable) |
| P3 | Deep-research prompts open with "a colleague in an Austrian architecture and planning office" | `agents/deep_researcher/prompts/{orchestrator,researcher,planner,writer}.j2:1` [S] | S1 |
| P4 | Intake agent: Bundesland, Geschoße, Fluchtniveau, Gebäudeklasse; summary "in German" | `agents/intake/prompts/system.j2` [V] | S1 |
| P5 | `piloti.j2` turn context: `oib_applicability` and "Bundesland/OIB edition" in reference projects | `agents/piloti/prompts/piloti.j2:60-91` [S] | S1 | <!-- brand-history -->
| P6 | Tool descriptions with OIB, GK and "Austria runs UTC+1/+2" | `tools/bim/measure_input.py:176`, `tools/cross_project/register.py:332, 776`, `tools/bim/register.py:222`, `tools/documents/tools.py:142-172` (`/law/oib/` mount) [S] | S1 each |
| P7 | MCP door copy: `knowledge-base-get`, `norm-list` ("Austrian laws", `federalState` "Wien"), `project-standards-get` (OIB), `bim-check-*` ("OIB rule catalogue"), `door/prompts/building-law-check.md`, `door/guide.md`, `discovery.ts:627-631` | `apps/workspace/bff/agent-api/...` [S] | S2 |
| P8 | German canned replies and German HyDE / query expansion tie answers to the German corpus | `common/canned_replies.py:14-36`, `common/hyde.py`, `common/query_expansion.py` [S] | S2 |

### 2.4 UI and i18n

| # | Coupling | Path | Sev |
|---|---|---|---|
| U1 | Locales closed to `en`, `de` (UI tuple and DB CHECK) | `apps/workspace/i18n/config.ts:12`; `migrations/0156…sql:25` `CHECK (default_locale IN ('de','en'))` [V CHECK] | S2 |
| U2 | Plural rule `n === 1` (de/en only) | `i18n/translate.ts:36-41` [S] | S2 |
| U3 | Intake copy: `A2_country` options `at/de/ch/other`, `A2_land` nine Länder + `outside_austria`, comment "the agent is Austria's"; Flächenwidmung categories; `FOUND_IN` (Einreichplan, Bescheid, Grundbuchauszug, Gefahrenzonenplan, Denkmalliste BDA) | `bff/project-profile/intake-stages/project-basis.ts:36-80` [V]; `plot.ts:38-52`, `intake-options.ts:24-47` [S] | S3 |
| U4 | "Bundesland" in about 34 UI and BFF files; norm registry admin page with no country selector | `ui/features/platform/components/norm-registry.tsx` [S] | S2 |
| U5 | Website default `de`, workspace default `en`; `de-AT` date formats | `apps/website/src/i18n/paths.ts:9` [S] | S1 |
| U6 | Legal pages (imprint ECG/MedienG/GewO, DSGVO, subprocessors) German and Austria-specific | `bff/legal/content/de.ts` [S] | S1 per country |

### 2.5 Schema (Postgres, Qdrant payload, wire)

| # | Coupling | Path | Sev |
|---|---|---|---|
| X1 | No `country`/`region`/`residency` column on any table; the org row is `{workos_organization_id, display_name, default_locale, settings jsonb}` | `bff/db/schema/organizations.ts:22-32` [V by grep] | S4 (new concept) |
| X2 | Jurisdiction as free text without a CHECK: `permit_records.federal_state`, `document_search_facets.federal_state`, `municipality` | `db/schema/permit-records.ts:84`, `document-search.ts:55` [S] | S2 |
| X3 | Project jurisdiction only as jsonb profile keys (`facts.country`, `facts.federal_state`); intake `location` jsonb typed `GeocodeResult` (AT literal) | `db/schema/projects.ts:22-25`, `project-intakes.ts:39` [S] | S2 |
| X4 | `permit_records.kind` CHECK of four values (Bescheid-shaped) | `permit-records.ts:108` [S] | S3 |
| X5 | Full-text `to_tsvector('german', …)` plus `grid_fold_german` | `migrations/0185_document_search.sql:93`, `0188` [S] | S3 |
| X6 | Qdrant `FACT_KEYS = (federal_state, building_class, construction_method, uses, work_type)`, legacy `bundesland`; **no `country`, `edition`, `valid_from`, `language` payload field** although `docs/architecture/qdrant-retrieval-design.md` §4 names `country` and `edition` | `vector_store/schema.py:186-196` [V] | S3 |
| X7 | `oib_corpus_files`: no source URL, publisher, edition, validity, licence or language | `packages/agent/src/agent/corpus_store.py:95-106` [V] | S3 |
| X8 | `norm_registry` store keyed `country String(8)` (ready), but no route or loader passes a country | `knowledge/norm_store.py:189, 199-248` [V] | S2 |
| X9 | BFF `normsFileSchema` `version: z.literal(1)`, `corpus_collection` default `oib_knowledge`, profile override fields with no UI | `bff/norms/schemas.ts:145-162` [S] | S2 |
| X10 | Wire field names `federalState`, `buildingClass` 1-5 on MCP operations | `agent-api/catalog/knowledge.ts`, `bim.ts` [S] | S2 |

### 2.6 Infrastructure

| # | Coupling | Path | Sev |
|---|---|---|---|
| I1 | One cluster, one kubeconfig, one production stack named `prod` (`PRODUCTION_STACK` gates the in-cluster backup refusal) | `deploy/pulumi/src/platform/providers.ts:13-18`; `src/config/barman-backups.ts:66, 93` [V 66] | S3 |
| I2 | `baseDomain: piloti.at`, Velero to `backupspace.at` | `Pulumi.prod.yaml:126` [V]; `docs/deployment/kubernetes.md:335` [S] | S2 | <!-- brand-history -->
| I3 | Fixed bucket names `grid-org-`, `grid-documents`, `grid-pg-backups`; ADR-0147 rename to `workspace` in flight | `src/config/seaweedfs.ts:366`, `postgres.ts:108`, `src/names.ts:18-19` [S] | S2 |
| I4 | Public geocoder default `https://photon.komoot.io` | `deploy/pulumi/src/config.ts:575` [V] | S1 (config), residency issue |
| I5 | Egress open by design (OpenRouter, Tavily, WorkOS, ACME, Photon) | `src/platform/network-policies.ts:53-60` [S] | S3 for enforcement |

---

## 3. Existing seams and abstractions

### 3.1 `CountryProfile` (Python)

**What it gives.** A registry keyed by ISO code, a frozen dataclass, a data-over-code override from the country's registry file (`with_overrides` ignores empty values), and two named code hooks. The design rule "every field has a live consumer" is the right instinct. ADR-0025 recorded what happens without it (section 6).

**What is actually live** [V, by grep of `packages` and `apps` for each field]:

| Field | Reader outside `country_profile.py` | Verdict |
|---|---|---|
| `doctrine` | `norm_registry.doctrine_for` → deep researcher only | live, partial (the agent uses the static prompt) |
| `corpus_note` | `render_block_for_prompt` → deep researcher only (`factory.py:157`) | live, deep-research only |
| `parcel_tags` | `_parcel_tags_for(country)`, but both callers pass no country, so always AT | effectively constant |
| `corpus_collection` | `knowledge-layer/src/search/scope.py:resolve_base_collection` (re-routes only when the config equals the AT default) | live |
| `states` | overridden from the file, **never read**. Jurisdiction reads `FEDERAL_STATE_TOKENS` directly | dead (so an admin edit of `states` has no effect) |
| `state_probe_order` | none | dead |
| `language` | none | dead |
| `legal_source_tools` | none | dead |
| `applicability` | none; callers import `render_project_block`/`resolve_oib_applicability` directly | dead as a hook |
| `corpus_doc_class` | none; `oib_doc_class` is called directly in 5 places | dead as a hook |

So 6 of 11 fields have no reader. The contract fails its own docstring, which lists consumers for all of them (`country_profile.py:25-33`) [V].

**Gaps.** The profile is a *per-country* bag, while the founder's unit is jurisdiction × area × edition × owner. It has no notion of state or municipality granularity, editions, validity, licence, owner (platform vs office), connectors, authorities, calendars or advice policy. It lives only in Python, while the BFF (intake, derivation, applicability TS, geocoder, location register, BIM rules) has no country registry at all. Unknown country fails open to AT, which is a wrong-law answer, not a safe default.

**Keep or replace.** Keep the lesson (a field needs a consumer; data before code; one source adapter per legal database). Replace the shape. A country is not a dataclass of prompt strings. The two hooks are real behaviour that differs by legal system, but they belong to an area and edition (OIB 2023 Begriffsbestimmungen), not to "the country".

### 3.2 Norm registry and its admin store

**What it gives.** A curated, verified pointer catalogue with fail-open loading, store-first precedence over a YAML seed, optimistic versioning (`put` returns `None` on a version mismatch, which becomes 409), an audit record in the BFF, live verification against RIS (`/v1/admin/norms/verify`), a `review_note` TODO queue, and a rank vocabulary that already separates `external_standard` (norms) from law. The store table is keyed by country.

**Gaps.** No edition, validity, typed relation, licence, area tag or owner. No draft or publish step: a PUT is live for every org (scout 12). The access path is AT-only (C3, C28, X8). YAML of a second country would **merge into the AT catalogue**. Entries pin `full_law_url` to `GeltendeFassung` (today's consolidated text) [V], so a pointer cannot express "as of date X". Validation rejects any entry whose Land is not Austrian or whose application is not a RIS one.

### 3.3 Collections and retrieval scope

**What it gives.** One compile point for read filters (`scope_filter`, refuses an empty scope list). Two physical collections chosen by name prefix: `TENANT_PREFIXES` (office shelf, `proj_`, `s_`) go to `office`, and everything else goes to the shared `corpus` (`vector_store/schema.py:329-357`) [V]. A signed envelope carries the scope list. Per-country base routing goes through the profile. A range grammar (`$gte`/`$lte` on datetime fields) is ready for validity filters.

**Gaps.**
- No `country`, `edition`, `valid_*`, `jurisdiction`, `language`, `licence` or `owner` payload fields.
- `office_id` is written (`writes.py:55-70`) and indexed (`schema.py:240`) but not filtered. ADR-0116 says every filter carries it, and the code does not [V]. Isolation rests on the signed scope list alone. Any unprefixed name a developer writes lands in the shared corpus that every office reads.
- Restricted folders are still collection names (`<base>_r<hex>`), not a payload field (scout 03).
- A single German analyser.

### 3.4 Platform → org inheritance

**What it gives.** Global platform tables (`platform_*`) readable by tenants, with org overrides per agent group for models. Guards on the `organizations.settings` bag: `PLATFORM_OWNED_SETTINGS` (quota, upload size) only platform staff write, and `DEDICATED_ROUTE_SETTINGS` are written only through their own audited route. Lessons have a `candidate → active → retired` lifecycle. Platform skills have `published` draft state. These are the patterns an "owner: platform vs organisation" primitive generalises.

**Gaps.** No country dimension on platform defaults. No entitlement model for "countries enabled" (feature flags are WorkOS per-org flags, `bff/authz/feature-flags.ts`; e.g. `ifcModels`, whose comment notes it renders OIB verdicts [V]). Office knowledge and platform knowledge are **different stores** today: platform corpus table plus `oib_knowledge`, against the office shelf collections with `document_metadata`. They do not share an item model, an edition or freshness. Ticket 32's "same primitives, owner differs" has no starting point except the shared Qdrant payload schema.

### 3.5 Intake versioning and the profile

**What it gives.** Questions as data (`id`, `writesTo`, `foundIn`, `conditions`, `options`, `why`). A country condition already gates `A2_land`. `legacy-names.json` gives expand-and-contract renames with SQL triggers (0159-0162). Suggestion-then-confirm with evidence on the profile (ADR-0111). Decisiveness is computed rather than listed. The location register is data.

**Gaps.**
- `projectIntakeDefinitionV1.version: 5` has no consumer that records which version produced an answer (scout 06, grep).
- One definition serves every country.
- The register and derivation are AT-typed (`FederalState` union, OIB thresholds).
- No date questions for active projects.
- The intake agent cannot reach anything outside the project's documents.

### 3.6 Exposure config and the agent door

**What it gives.** One file (`exposure.config.ts`) decides per operation whether it is `external`, `piloti` (or `native:<tool>`), `platform` or `withheld` with a category and reason. The platform door (`/api/platform/mcp`, ADR-0126) carries fleet-wide writes (`platform-norm-registry-update`, corpus upload, reingest), each `destructive: true`. A country's *data* half has a natural home there. <!-- brand-history -->

**Gaps and contradictions.**
- `law-lookup` is `external: true` (`exposure.config.ts:714`) [V], while `docs/architecture/agent-surface.md:371` lists "RIS texts" as withheld `external-service` [V]. The doc is stale.
- `address-search` is withheld from the agent as well (`:470-474`) [V], so no agent, including a setup agent, has a geocoding operation.
- Operation descriptions carry Austrian specifics, which a per-country catalogue would fork.

### 3.7 Old docs vs current code

| Document claim | Code | Status |
|---|---|---|
| `country-extensibility.md`: `states` consumed by `extract_federal_state`/`resolve_federal_state` | they read `FEDERAL_STATE_TOKENS`/`BUNDESLAENDER` directly | wrong [V] |
| `country-extensibility.md`: `legal_source_tools` consumed in prompt and doc references; `language` consumed by classification and prompts; hooks consumed through the profile | no readers | wrong [V] |
| `country-extensibility.md` and `country_profile.py` docstring: "every field has a named live consumer" | 6 of 11 dead | wrong [V] |
| `country-extensibility.md`: "one collection per country … membership in the base collection *is* the country tag" | `scope.py` routes only when config equals the AT default; no country payload | partly true, untested for country 2 |
| `country-extensibility.md` phase 1: "add `registry.yml`" | `load_registry` merges all files; store and admin AT-only | misleading [V] |
| `country-extensibility.md`: `oib_knowledge` at 6 sites | about 38 non-test files | stale [V] |
| ADR-0025: the pre-move path of `norm_registry.py` (before the package moved to `packages/agent`), German ranks | `packages/agent/src/agent/common/norm_registry.py`, English ranks plus `LEGACY_NORM_RANK` read-only aliases | stale [V] |
| ADR-0025 Consequences: "Statute texts are re-fetched per session (no persistent RIS cache)" | 7-day Dragonfly cache (`ris-adapter/src/cache.py`, `RIS_CACHE_TTL_DAYS` default 7) | stale [V] |
| ADR-0025: the Punkt chunker was deleted for shredding OIB text | `ingest/clause_chunking.py` cuts per Punkt again (`chunking: "clause"`), `CHUNK_FORMAT_VERSION = 4` | reintroduced; the ADR does not say so [V] |
| ADR-0025: "Bundesland vocabulary and doctrine move to data when country #2 ships" | doctrine overridable; Bundesland is code and validated in `_validated_entries` | partly stale |
| `backend-deep-dive.md` §6b: `resolve_country` handles `at/de/ch/other` | `other` resolves to `at` | wrong [S per scout 01, consistent with V regex] |
| `agentic-project-intake.md`: typed line kept as `standort_adresse`; intake records `oib_edition` | key is `site_address`; no intake writer of `oib_edition` | stale [V] |
| `piloti.j2:4` calls the static prompt `piloti_static.md` | file `chat_static.md` (fallback), Langfuse name `piloti-system-static` | naming drift [V] | <!-- brand-history -->
| ADR-0116: every filter carries `office_id` | `scope_filter` keys on `scope` only | wrong [V] |
| `qdrant-retrieval-design.md` §4: `country`, `edition` corpus fields | absent from schema | design, not built [V] |
| `agent-surface.md:371`: RIS texts withheld | `law-lookup` external | doc stale [V] |
| `legal/content/de.ts:332`: NVIDIA (`integrate.api.nvidia.com`) for embeddings "in the standard configuration" | Pulumi default `embedBaseUrl` `https://openrouter.ai/api/v1` (`deploy/pulumi/src/config/app-services.ts:124`); env doc same | legal copy stale [V] |
| Compliance audit 2026-07: OpenRouter path has no ZDR pinning | `common/openrouter.py:82` `ZDR_PROVIDER_ROUTING = {"zdr": True, "data_collection": "deny"}` plus EU-preferred `provider.order` | audit finding partly closed since; EU is preferred, not guaranteed [V] |

---

## 4. Duplications and contradictions between scout reports

### 4.1 Duplicated vocabularies (the copies themselves)

**Bundesland token set.** Every scout found part of this. The union, with what I verified:
1. `norm_registry.BUNDESLAENDER`, `FEDERAL_STATE_TOKENS` [V]
2. `project_context._FEDERAL_STATE_TOKENS` [V]
3. `ris-adapter/src/register.py:81-90` `_FEDERAL_STATE_PARAMS` [S]
4. `apps/agent-host/.../routes/norms.py:36` [S]
5. `scripts/build_ris_catalog.py:84` [S]
6. `permit_extraction.FederalStateToken` [V]
7. intake `A2_land` options (TS source; geocoder `LAND_OPTIONS`, `intake-conditions.FEDERAL_STATE_TOKENS` and the prompt view all derive from it) [V]
8. `location-register.FederalState` type [V]
9. `profile_names.LEGACY_PROFILE_TOKENS` and `legacy-names.json` [S/V]
10. SQL functions in migration 0162 [S]
11. Qdrant `LEGACY_FIELDS` and `boost.py` legacy re-mapping [S]

The TS side is single-sourced from the wizard (scout 16 is correct). The Python side has at least four independent copies. A parity test across them was not found (open in scout 01, still open).

**OIB-RL list and verdicts.** Python `applicability.py`, TS `applicable-standards.ts`, BFF `standards-catalog.ts`, BIM `rules.ts`, intake `derivations.ts` (GK). ADR-0025 decision 6 deliberately accepted two hand-written applicability functions. `compliance-derivation-graph.md` §2 (cited by the intake design) counts five encodings of one rulebook. That is the most expensive duplication for a second country.

**Document type and discipline tags.** Python plus a hand mirror in TS, held by a parity test (scout 11) [S].

### 4.2 Contradictions between scouts, and which is right

| Topic | Scouts say | Verified answer |
|---|---|---|
| Number of `oib_knowledge` sites | 01, 14: "6 per doc, confirmed 1-2"; 03: five named | About 38 non-test files across Python, TS, deploy and agent-host [V]. All scouts undercounted |
| Does `states` on the profile feed jurisdiction? | 05 and 11 repeat the docstring ("states → extract_federal_state"); 01 says no reader | 01 is right [V] |
| `CountryProfile.language` consumer | 04, 10: none in Python, TS unchecked | No reader anywhere in `packages`/`apps` Python; the TS side has no profile at all [V] |
| `country=other` | 06 and 16: the intake emits `de`/`ch`/`other`; 01: `other` resolves to AT; 04: unknown country resolves to AT | Both true together. The prompt view writes `- country=other` (all facts are rendered); the regex misses it, so `at` [V]. For `de`/`ch` the regex matches, the profile is `None` and callers fall back to AT, with the same outcome |
| Applicability hook wired through the profile | 05 ("wired through `render_project_block`"), 11 ("German implementation would replace this function") | Not through the profile. Direct import, no country gate. Replacing the hook would change nothing [V] |
| Who computes GK | 13: "Gebäudeklasse is never derived" (BIM); 06: derived by `withDerivedClass` in the intake | Both, in different subsystems. The intake derives it (BFF); the BIM path takes it as caller input. A second disagreement: `C_GK_CONFIRM` copy says "noch nicht automatisch gesetzt" (06, unverified) |
| Live system prompt | 04: `chat_static.md` with drift question | `chat_static.md` is the bundled fallback; the live text comes from Langfuse `piloti-system-static` [V]. Country-keying can be a Langfuse prompt per country, but the repo file is not authoritative about production | <!-- brand-history -->
| Geocoder state | ticket 31 note and 06: off unless `GEOCODER_URL`; 08/09: komoot default | Code: the BFF is off without `GEOCODER_URL` (`geocoding/service.ts`); Pulumi now always sets it, defaulting to komoot (since 2026-11-03) [V]. Live prod state unverified |
| `LANGFUSE_HOST` defaults to Langfuse Cloud (09) | — | True only for a deployment outside Pulumi. Pulumi sets `http://langfuse-web:3000` (`deploy/pulumi/src/app/config.spec.ts:32`) [V]. Low risk for prod |
| Embedding provider (09 open question) | env doc vs legal page | OpenRouter in code and deploy defaults; the legal page is stale [V] |
| ZDR (09, R2 citing the July audit) | "no ZDR pinning", "region not enforced" | ZDR is pinned by default at one seam (`common/openrouter.py`, ADR-0074), with an EU-first provider order, but **an org can switch it off** (`isZdrOnlySetting: value !== false`, `organizations/service.ts:430-431`), and the EU guarantee (`eu.openrouter.ai`) is not used [V] |
| RIS point-in-time (02, R3) | 02: search only; R3: RIS supports `FassungVom` | The adapter sets `Fassung.FassungVom` only for `BrKons` (federal consolidated). Land building law (`LrKons`) gets no date. `ris_lookup`, the agent's actual tool, takes no date and catalogue URLs point at `GeltendeFassung` [V] |
| ADR-0025 and the deleted abstraction (14) | "history unreadable, shallow clone" | Correct: 130 commits, the oldest 2026-10-28. ADR-0025's Context is the only record [V] |
| `rules.ts` over 600 lines (13) | unverified baseline | Listed in `ci/size_baseline.json` (1549). `register.py` (986 baseline vs 1039 `wc -l`), `client.py` (649 vs 663) and `norm_registry.py` (1328 vs 1364) are also baselined. The line-count method may differ from `wc`, so I make no violation claim [V] |

---

## 5. Data location map

Physical location of the cluster is not in the repo. The sales FAQ says IPAX in Vienna. `docs/deployment/kubernetes.md` says IPAX managed k0s (scout 08).

### 5.1 Stores (in-cluster unless stated)

| Store | What it holds | Tenant boundary | Location / notes |
|---|---|---|---|
| CNPG Postgres `app` | orgs, projects, profiles (jsonb facts incl. address), intakes, documents metadata, permit records, conversations, tasks, platform tables, audit-adjacent rows | RLS `organization_id` (0031, fail-closed) | in cluster; PITR archive to in-cluster SeaweedFS by default (`pgBackupsEnabled: true`, endpoint unset), **unencrypted at rest on that target** (scout 08) |
| Postgres `jobs`, `checkpoints`; Hatchet's own cluster | job payloads, LangGraph checkpoints (14 days) | app-level | in cluster; Hatchet PITR off by default [S] |
| Knowledge DB (summary store URL) | `norm_registry` (one row per country), `oib_corpus_files`, document summaries/metadata | platform rows plus tenant rows by collection | same DB URL as the summary store (`norm_store.py` docstring) [V] |
| SeaweedFS | uploaded documents (per-org bucket `grid-org-*` in prod), platform bucket `base-corpus/` (OIB PDFs), PG backups, Qdrant snapshots | bucket per org | `single` topology in prod; chunk keys in filer metadata on the same PVC [S] |
| Qdrant | chunk text and vectors for corpus (`corpus`) and office (`office`); project facts mirror | logical `scope` from signed envelope; `office_id` written, not filtered [V] | self-hosted; read-only key not enforced (ADR-0116) [S] |
| Dragonfly | caches incl. RIS documents (7 d), ZDR flag (`zdronly:v2:<org>`), prompt views | tenant key in cache keys (lint rule) | in cluster |
| Langfuse (self-hosted) | full traces: question, answer, tool outputs incl. retrieved excerpts; scores; prompts (incl. live system prompt) | per project/org metadata | in cluster; 30-day trace retention default; chat-delete erasure [S] |
| Velero (IPAX) | nightly copy of every PVC | none | `b101294.backupspace.at`, outside the repo; the only offsite copy of prod [S] |

### 5.2 Outbound flows

| Flow | Data sent | Destination | Control today |
|---|---|---|---|
| Chat, research, intake, VLM, reranker, decisions | prompts with document excerpts, project facts | OpenRouter `openrouter.ai` (US gateway) to upstream providers | ZDR pinned by default, EU providers first, org may disable ZDR, BYOK may point elsewhere (`org_llm_credentials.base_url`) [V] |
| Embeddings (ingest and query) | every chunk text, every query | OpenRouter, `openai/text-embedding-3-large` | same seam; legal page names NVIDIA (stale) [V] |
| Permit extraction, project experience | up to 24k chars of a Bescheid; closed-project documents | OpenRouter, `PLATFORM_FIXED` | ZDR [S] |
| Web search | LLM-derived queries | Tavily (US) | deployment-wide key only; no per-org choice [S] |
| Geocoding | every keystroke of an address | `photon.komoot.io` (komoot / Bending Spoons) | default since 2026-11-03; **in no subprocessor register** (`legal/content/de.ts`, `docs/compliance/external-dependencies.md`) [V grep] |
| RIS | legal queries, document URLs | `ris.bka.gv.at` (AT government) | public, no tenant data beyond the query text |
| Identity, audit | users, emails, IP, user agent, **document filenames in audit events** | WorkOS (US) | no EU region documented (ADR-0002 open question) [S] |
| Analytics | events, replays, error data, Langfuse score comments | PostHog EU Cloud `https://eu.i.posthog.com` (`deploy/pulumi/src/config/posthog.ts:13`) [V] | erasure from Langfuse does not reach PostHog [S] |
| Push | encrypted payloads | browser push services | minimal content [S] |
| Live eval `turn-shapes` | RIS queries | RIS | dev only [S] |

### 5.3 What enforces location today

The model-call seam (`common/openrouter.py`, held by `test_openrouter_call_sites.py`, with `provider_limiter`) applies zero retention by default and prefers EU providers, but allows fallback. Upload screening (`iban`, `at_svnr`, `credit_card`) detects sensitive content in a file's text layer before any model reads it, with two exceptions: a scanned page is screened in the vision model's transcript, so that model has seen it, and the images embedded in a PDF go to the vision model unscreened (the file is marked `partial`; `knowledge-layer/src/ingest/adapter.py`, `_screen_or_quarantine`, `_record_unscreened_rasters`). It does not choose a processing region. Neither guarantees regional processing. Nothing records the processing location per call. Nothing allowlists egress (network policy is open on purpose). No data-class tag exists on any store or flow. The org has no residency field, and there is one deployment.

### 5.4 Sales FAQ promises, checked

| Promise | Code reality |
|---|---|
| Hosted at IPAX in Vienna | not stated in repo; one cluster, `piloti.at` domains | <!-- brand-history -->
| All LLM requests with ZDR | default on, org-switchable off; BYOK to a non-OpenRouter base URL bypasses OpenRouter's ZDR routing [V]. True by default, not enforced as a promise |
| US providers only with ZDR, EU when on par | EU-first ordering, no EU guarantee [V] |
| Only the relevant excerpt is sent | retrieval sends chunks; `read_document`/`document-look` send whole pages; permit extraction sends up to 24k chars [S]. Broadly true, not absolute |
| BYOK | yes, LLM only (`llm-credentials/providers.ts`) [S] |
| Exclusion list, sensitive-data quarantine, folder roles, DPA, export and deletion | exclusion list and screening exist (ADR-0086); deletion pipeline exists; PostHog, WorkOS audit and `llm_usage_events` are not purged [S] |
| "For Austria and Germany the most important law texts are in" | **False for Germany** [V]: `configs/norms/` holds only `at/`; no German statute, corpus, adapter or Länder vocabulary exists; the only German-law tokens in code are a citation-reference regex (`knowledge-layer/src/references.py:75` lists `BauGB\|BauNVO\|LBO`) and a docstring example "§ 33 BayBO". The intake help text itself says "Für Deutschland werden Fragebogen und Regelwerks-Layer noch angepasst" (`project-basis.ts`) [V]. For Austria: 24 pointers, live RIS, the OIB 2023 corpus |
| "Because we keep older versions, older projects get the law that applied then" | **False** [V]: corpus table and Qdrant payload carry no edition or validity; the family key strips the edition; older OIB files are hidden by a filename exclusion list; `ris_lookup` cannot ask for a date and cites `GeltendeFassung`; `ris_search` supports a date only for federal law; ADR-0111 says "the corpus holds one" edition |

---

## 6. Why the earlier country abstraction was deleted, and the lesson

**What existed.** ADR-0025's v1 draft (spec `docs/specs/2026-07-17-norm-registry-design.md` at `56ee3329`, implemented in PR #79; neither reachable in this shallow clone) modelled legal knowledge as one typed system:
- a per-country registry with ranks, roles and **nested editions**;
- a **typed relation graph** (`implements`, `declares_binding`, `supersedes`);
- a data-driven **applicability DSL** with TS codegen and parity fixtures;
- structure-aware Punkt chunking;
- a persistent RIS text cache with freshness re-validation;
- a **country-pack plugin protocol**.

**Why it went** (ADR-0025 Context, read [V]), after an adversarial review:
- the relation graph "computed nothing that reached the LLM" (its two consumers were dead or wrong);
- the norm resolver stamped wrong ids on cards ("OIB-Richtlinie 2" → `oib-rl-2.3`);
- the Punkt chunker shredded fire-resistance tables and fabricated "Pkt 90";
- the codegen broke the production build and existed only to keep two rule engines identical;
- the cache's freshness check was structurally inert;
- the country-pack protocol "served exactly one country".

The ADR's own diagnosis: "the machinery re-modeled knowledge that already lives in the corpus text, the filenames, or the prompt — and the bugs lived precisely in that redundant machinery." It was reduced to a flat catalogue plus prose notes plus an admin store, with "reintroduce a minimal typed `binding_edition` field only when a consumer exists".

**What happened next** [V]:
- Two of the deleted things came back in a better form: Punkt chunking (clause chunks with page chunks excluded) and a RIS cache (7 days, `DOC_TEXT_VERSION`).
- The `CountryProfile` that replaced the protocol has, three months later, six of eleven fields without a reader. The cut did not stop dead fields, because the docstring's consumer list was never tested.
- Editions were left out entirely. Ticket 30 now reopens exactly the parts that were cut (editions, typed binding relations, applicability), and its notes warn against "a return there".

**The lesson, stated so a designer can apply it:**
1. A typed relation or edition is justified only by a consumer that **changes an answer** in a test: an as-of query that picks a different edition, a citation that names its edition, a Steckbrief row. Ticket 30's acceptance criteria are those consumers ("what applied at the time of our submission … naming that edition"). The v1 graph had none, so it rotted. The same graph with these consumers would not.
2. The consumer rule has to be **mechanically held**, not a docstring. Section 3.1 is the evidence: the profile's consumer list drifted within one quarter. A test that fails on a contract field with no reader is the ratchet AGENTS.md asks for.
3. Do not encode the same rulebook twice to keep two engines identical. v1 died partly on codegen between Python and TS. Today's code still keeps OIB applicability in five encodings. The fix is one authored data source with one evaluator behind an API (ADR-0055), not a codegen bridge.
4. "Country" was the wrong unit for a plugin. Variation lives in a jurisdiction (Land, canton, municipality), an area (fire, energy, procurement), an edition and an owner. A per-country pack fork-copies all of them. A pack that serves one country is indistinguishable from hard-coding.
5. Prefer facts already in the source (RIS consolidated versions, the edition in the OIB masthead `Ausgabe: Mai <year>`, ELI ids) over re-modelling them by hand. v1's redundancy was hand-modelled knowledge that the sources already carried.

---

## 7. Facts verified, and facts still unverified

### 7.1 Verified in this pass (read the code or doc myself)

1. `CountryProfile`: 11 fields, `at` the only registration, `DEFAULT_COUNTRY = "at"`, unknown → `None` (`country_profile.py:45-135`).
2. Six profile fields have no reader: `states`, `state_probe_order`, `language`, `legal_source_tools`, `applicability`, `corpus_doc_class` (grep over `packages`/`apps`).
3. `resolve_country`: regex `\bcountry=([a-z]{2})\b`, default `at`. `country=other` resolves to `at`. `de`/`ch` give no profile and an AT fallback in `doctrine_for`, `render_block_for_prompt`, `resolve_base_collection` (`norm_registry.py:544-591`, `scope.py:45-72`).
4. The prompt view renders every fact as `- key=value` under `confirmed:` and derives `country=at` for legacy profiles (`prompt-view.ts:181-203`).
5. `RequestContext` has `federal_state`, no `country` (`project_context.py:192-238, 462, 610`).
6. `load_registry` merges all `*/registry.yml`; the store is read only for `at`; the admin routes take no country; the store table is keyed by country (`norm_registry.py:431-578`, `routes/norms.py:109-163`, `norm_store.py:189-248`).
7. OIB applicability runs with no country gate, called directly by the agent and the deep researcher (`applicability.py:462-479`, `piloti/prompt.py:353-366`, `norm_registry.py:713`). The TS twin has no `country` reference. <!-- brand-history -->
8. Trigger hints are Vienna-specific (`applicability.py:77-96`).
9. `parcel_note` is called without a country in both agents.
10. The the agent static prompt hard-codes the Austrian chain and voice. It is the bundled fallback for the Langfuse prompt `piloti-system-static`. <!-- brand-history -->
11. A typed address is stored as a confirmed fact (ticket 31 bug). `country=at` is also written when the chosen token is `outside_austria` (new bug) (`intake-seed.ts:44-76`).
12. Geocoder AT-only (`photon.ts:21, 111, 127, 164-165`, `types.ts:46`). Pulumi defaults `GEOCODER_URL` to komoot since commit `7513296` (2026-11-03).
13. Intake: `A2_country` offers `at/de/ch/other`; `A2_land` is AT-only with `outside_austria`; the help text says the German questionnaire is still being adapted.
14. Active projects capture no dates. Closed projects carry a month-precision `startedOn`/`endedOn`. No intake writer of `oib_edition`.
15. The intake agent's toolset has no web, RIS or geocoder. `address-search` is withheld from the agent and external agents. `law-lookup` is external, contradicting `agent-surface.md:371`.
16. No German law integrated anywhere; `configs/norms/` holds only `at/`; 24 registry entries.
17. No edition or validity anywhere in the corpus: `oib_corpus_files` columns, Qdrant schema (no `country`, `edition`, `valid_*`), the family key strips the edition, `exclude_file_names` hides OIB change documents by filename. RIS `FassungVom` applies to `BrKons` only; `ris_lookup` takes no date; registry URLs are `GeltendeFassung`.
18. `office_id` is written and indexed but not filtered; the physical split is by name prefix.
19. No `country`/`region`/`residency` column in any schema file; locale CHECK `('de','en')`; `OFFICE_TIME_ZONE = 'Europe/Vienna'`.
20. ZDR routing pinned at one seam with an EU-first provider order; an org can turn ZDR off; `eu.openrouter.ai` is not used.
21. The embedding default is OpenRouter in deploy and env docs; the legal page names NVIDIA (stale); komoot is in no subprocessor register.
22. Pulumi sets `LANGFUSE_HOST` to the in-cluster service; PostHog defaults to the EU host.
23. Permit extraction and project-experience prompts say "in Austria"; `FederalStateToken` is AT-only.
24. ADR-0025 history and its drift: the RIS cache (7 d) and the Punkt chunker exist again.
25. Ticket 31 text (Notion, ID 31, created 2026-10-28) matches the orchestrator's summary.
26. German-only BM25 and Snowball stemmer on Qdrant.

### 7.2 Still unverified (from scouts; plausible, not re-read)

- Exact line numbers and contents of `citations/binding.py` RIS and OIB detection, `lane_for_hit` hosts, `missing-sources.ts` RIS regex.
- Contents of the GK thresholds in `derivations.ts` and `bim/profile.ts` escape bands (numbers per scouts 06 and 13).
- Bundesland copies in `ris-adapter/register.py:81`, `routes/norms.py:36`, `scripts/build_ris_catalog.py:84`, migration 0162 SQL functions, `boost.py` legacy mapping; absence of a cross-copy parity test.
- Migrations 0018, 0053-0057, 0185, 0188 contents; `permit_records.kind` CHECK; free-text `federal_state` columns without a CHECK.
- Infrastructure details beyond what is listed in 7.1: in-cluster PITR target unencrypted, Velero target, bucket names, single `prod` stack assumption downstream, open egress policy.
- WorkOS audit events carrying document filenames; WorkOS data region; Tavily retention; komoot terms and hosting.
- Whether `dev` and `prod` share a cluster; where IPAX's data centre is.
- Whether non-confirmed profile facts are excluded before the prompt view renders `confirmed:`.
- The `C_GK_CONFIRM` copy ("noch nicht automatisch gesetzt") against the derivation in the UI.
- Whether the intake definition version is recorded anywhere (scout 06 found no consumer).
- Restricted-folder collections still name-based (`<base>_r<hex>`); ADR-0104 slice 6 status.
- Whether prod currently runs the komoot geocoder (code default yes; deployment state unknown).
- The 52-entry golden set and `calibration_pending` on every entry.
- Doc-class TS/Python parity test; filing defaults; website locale defaults; pinned `de-AT`/`de-DE` sites.
- The deep-research templates' opening line ("Austrian architecture and planning office") and `jurisdiction_grounding` wiring beyond the orchestrator.

### 7.3 Notes for the designers (from the verification, not design)

- Three live correctness defects for any non-AT project, before anything is built: C2 (unknown country gives AT law), C6/C17 (OIB verdicts for every country), C20 (`country=at` for `outside_austria`). Plus C7 for non-Vienna Austrian projects.
- The strongest existing seams to build on: the location register (data, per region, document to request, reason); profile suggestions with evidence plus confirmation (ADR-0111); the one model-call seam (ADR-0074/0081); the platform door with `destructive` writes (ADR-0126); the `norm_registry` store already keyed by country; Qdrant's range grammar for validity filters; lessons' `candidate` and skills' `published` as draft-state precedents.
- The tension to resolve explicitly: ADR-0122's amendment withholds proxied public services (geocoding, web search) from every agent, while ticket 31 needs a setup agent that calls public location sources with provenance.

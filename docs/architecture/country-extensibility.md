# Country extensibility — a country is records, and the add-a-country checklist

Status: Active, rewritten 2026-11-10 for ADR-0175. Companion to ADR-0165,
ADR-0168, ADR-0173 and `backend-deep-dive.md` §6b.

Piloti ships Austria-first, but the product goal is multi-jurisdiction. Until
ADR-0175 a `CountryProfile` in code (`common/country_profile.py`) decided which
country's law a project read, from the project's own text, with Austria's
doctrine, corpus note and OIB verdicts (`common/applicability.py`) as code. All
of it is gone. A country is now **records**: its territories, works, editions,
relations, coverage and rulesets, published in its pack through
`records-propose` (ADR-0165, ADR-0168). The BFF resolves a turn's knowledge
context and chain text from them (ADR-0173), and the agent reads nothing else.

## What the agent reads

| What | From | Where in the agent |
|---|---|---|
| Which countries a turn may retrieve, the gate, coverage | `knowledgeContext` in the turn context, or `knowledge_context` in a research run's payload | `common/knowledge_context.py` |
| Which edition binds at the site, and every edition's role | `buildingLaw` (turn context) or `building_law` (run payload): the chain text and the uses | `citations/roles.py`, `common/law_gate.turn_building_law_block` |
| Whether a legal-database adapter may run | the gate, and the adapter's own country (`law_gate.LAW_SOURCE_COUNTRIES`: `ris` is `AT`) | `common/law_gate.law_sources_withheld` |
| How to reason about building law anywhere | constant: `<legal_method>` in `chat_static.md`, `law_gate.LEGAL_METHOD` for deep research | |

Absent or malformed, the context is `knowledge_unavailable`: no verdict, no
edition named binding, no legal-database tool, the gate's note.

## Adding a country: the checklist

Phase 1 — records and corpus:
1. The country's pack: territories, works, editions, relations, coverage,
   proposed through the platform door (`records-propose`), reviewed, released.
2. Its texts in the shared corpus, each chunk carrying its `country_id`
   (ADR-0173), through the platform's indexing job.

Phase 2 — the one real code artifact:
3. A source adapter for the country's legal database (Germany:
   gesetze-im-internet + Länder portals), following `packages/ris-adapter` as
   the template, or a configured source record under `configs/sources/`
   (ADR-0162). Name its data source id and country in
   `law_gate.LAW_SOURCE_COUNTRIES`, so the gate decides when it runs.

Phase 3 — vocabulary and language surfaces (scoped per country):
4. Document classification: `document_classification.py` tag vocabulary +
   German prompt ("österreichisches Architekturbüro") need per-country
   vocabulary/prompt variants.
5. Intake facts: `intake-definition.ts` carries AT-specific vocabularies
   (bundesland options, `building_class` GK1–5, `escape_level` >22m bands,
   `land_designation` options, the four AT boolean triggers); the setup facts
   are moving into ruleset records (ADR-0169).
6. Request envelope: its `federal_state` is AT-vocabulary. The agent no longer
   reads it for which law applies; the RIS adapter still uses it to address a
   lookup to the right Land.

## Known duplications (consolidate opportunistically, never let them drift)

- **9-state vocabulary — 4 copies:** `norm_registry.BUNDESLAND_TOKENS` (source
  of truth), `project_context._FEDERAL_STATE_TOKENS` (deliberate mirror, import
  cycle), `ris_adapter._FEDERAL_STATE_PARAMS` (RIS filter keys), and
  `intake-definition.ts` options. A parity test pinning the Python copies to
  `norm_registry` is the cheap guard.
- **`oib_knowledge` default:** NormsFile default, three config YAMLs
  (`COLLECTION_NAME` fallback), and `collection-scope.ts`. One shared corpus
  holds every country; the knowledge context filters it by `country_id`.

## What deliberately stays Austria-scoped

The RIS adapter package (client, planner, application enums) — that *is*
Austria's legal-database implementation, correctly isolated. Universal
mechanisms confirmed country-agnostic by inventory: collection layering &
merging, scoping headers, the request-envelope machinery, the classification
and compliance pipelines (mechanism, not vocabulary), "answer in the user's
language" prompt rules.

## OIB editions per Land

Which edition of the OIB-Richtlinien each Land has declared binding. The
source of truth is now the Austria pack's relation records
(`configs/knowledge-packs/at.json`, ADR-0168), proposed and published as a
change request and checked Land by Land against the OIB's own table of in-force
dates (<https://www.oib.or.at/kernaufgaben/oib-richtlinien/#inkrafttreten>,
Stand Oktober 2026, read 2026-11-10) in
`apps/workspace/bff/base-knowledge/chain/packs.spec.ts`. The pack also holds
the 2019 adoptions each 2023 one replaced, so an earlier date resolves too. This
table is the summary; the LGBl. numbers come from RIS and secondary
consolidations: re-check each on RIS before quoting it.

- Niederösterreich's day is 2025-03-18 (the OIB's table).
- Salzburg: the OIB lists 2026-08-06, RIS 2026-09-01; the pack takes the OIB's
  day. Salzburg adopted no RL 6 in 2019 or 2023, and the OIB's 2015 table lists
  RL 6:2015 in force there since 2016-07-01, never replaced. The pack holds no
  2015 edition, so RL 6 reads as guidance in Salzburg, not as the 2015 edition
  that may still bind: add it before quoting RL 6 for a Salzburg project.

| Land | Binding edition | In force since | Instrument |
|---|---|---|---|
| Wien | RL 1–5: 2023, RL 6: 2025 | 2024-02-23; RL 6 2026-07-15 | WBTV 2023 (LGBl. 14/2024), RL 6 by LGBl. 26/2026 |
| Niederösterreich | RL 1–6: 2023 | 2025-03-18 | NÖ BTV 2014 as amended by LGBl. 41/2025 |
| Oberösterreich | RL 1–5: 2023, RL 6: 2019 | 2025-10-01; RL 6 2020-09-01 | Oö. BauTV-Novelle 2025 (LGBl. 70/2025) |
| Steiermark | RL 1–6: 2019 | 2020-09-01 | StBTV 2020 |
| Kärnten | RL 1–6: 2023 | 2024-12-31 | K-BTV 2024 (LGBl. 105/2024) |
| Salzburg | RL 1–5: 2023; RL 6: no adoption listed | 2026 (OIB: 2026-08-06; RIS: 2026-09-01) | Bautechnikverordnung LGBl. 83/2026 |
| Tirol | RL 1–5: 2023, RL 6: 2025 without Pkt 2.2 and 2.3.1 | 2026-07-16 | TBV 2026 § 43 (LGBl. 59/2026) |
| Vorarlberg | RL 1–6: 2019 | 2022-01-01 | BTV as amended by LGBl. 67/2021 |
| Burgenland | RL 1–6: 2019 | 2021-04-10 | Bgld. BauVO 2008 as amended by LGBl. 22/2021 |

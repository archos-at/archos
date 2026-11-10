# Country extensibility — the CountryProfile contract and the add-a-country checklist

Status: Active (2026-07-18). Companion to ADR-0025 v2 and `backend-deep-dive.md` §6b.

Piloti ships Austria-first, but the product goal is multi-jurisdiction. This
document is the honest map of what that takes: the binding contract that already
exists (`packages/agent/src/agent/common/country_profile.py`, Austria = implementation #1),
and the complete inventory of remaining Austria/German couplings a second
country must address — so "add Germany" is a checklist, not archaeology.

## The contract

`CountryProfile` — design rule: **every field has a named live consumer; adding
a field without wiring its consumer in the same change is forbidden** (this is
what kept the previous country abstraction honest-free and got it deleted).

| Field | Kind | Consumer today |
|---|---|---|
| `states` / `state_probe_order` | data (registry-overridable) | jurisdiction resolution (`extract_federal_state`/`resolve_federal_state`) |
| `language` | data | classification/prompt language (consumer grows with i18n work below) |
| `doctrine` | data | `{{ norm_doctrine }}` in researcher/planner/writer prompts. Piloti holds the AT text inline in its system prompt `prompts/chat_static.md` (`<building_law>`), because only `at` is registered and the text is therefore constant per deployment. The renderer that moves it into the turn context exists (`turn/building_law.py`, ADR-0168): the block renders there, for an Austrian site or from the platform records' chain, once the static prompt no longer holds it — ADR-0060 amendment |
| `corpus_collection` | data | retrieval base-collection routing; admin store |
| `corpus_note` | data | catalog prompt block corpus section |
| `parcel_tags` | data | `parcel_note` per-parcel source-of-truth signal |
| `legal_source_tools` | data | prompt/doc references to the country's legal-DB tools |
| `applicability` | code hook | compliance Stage-1 scoping + prompt applicability section |
| `corpus_doc_class` | code hook | `lane_for_hit` display tagging |

Data fields default from AT code constants and are overridable per country in
`configs/norms/<cc>/registry.yml` (admin-editable via the platform norms
store). **One collection per country** is the corpus rule: membership in the
country's base collection *is* the country tag — org/project/session
collections stay country-agnostic; the project's country selects which base
collection joins its retrieval scope.

## Adding a country: the checklist

Phase 1 — data + corpus (days):
1. `configs/norms/<cc>/registry.yml`: catalog entries (verified pointers into
   the country's legal database), `states`, `doctrine`, `corpus_note`,
   `parcel_tags`, `language`, `corpus_collection`.
2. Create the corpus collection and upload the country's norm texts
   (platform Base-Knowledge surface).
3. Register the `CountryProfile` instance (one function in
   `country_profile.py`) with its two code hooks.

Phase 2 — the one real code artifact (weeks):
4. A source adapter for the country's legal database (Germany:
   gesetze-im-internet + Länder portals), following `packages/ris-adapter` as
   the template — tools, planner prompt, URL predicates all live inside the
   adapter package. Note: the adapter's state-filter vocabulary must consume
   the profile's `states`, not re-declare it (RIS adapter currently
   re-declares — see Known duplications).

Phase 3 — vocabulary and language surfaces (scoped per country):
5. Document classification: `document_classification.py` tag vocabulary +
   German prompt ("österreichisches Architekturbüro") need per-country
   vocabulary/prompt variants keyed off `language`.
6. Intake facts: `intake-definition.ts` carries AT-specific vocabularies
   (bundesland options, `building_class` GK1–5, `escape_level` >22m bands,
   `land_designation` options, the four AT boolean triggers) — country #2 needs its own
   question set; the intake machinery itself is versioned and generic.
7. Agent identity prompts: the j2 prompts hardcode "Austrian building
   regulations / RIS / OIB" framing — template off the profile
   (`country_name`, `legal_source_tools`) when country #2 ships.
8. Request envelope: its `federal_state` is AT-vocabulary; add a
   `country` envelope field alongside it (the structured `country=<cc>` prompt
   fact is already parsed by `country_profile.resolve_site`, which never
   defaults to Austria: an unplaced project is `site_unknown`).

## Known duplications (consolidate opportunistically, never let them drift)

- **9-state vocabulary — 4 copies:** `norm_registry.BUNDESLAND_TOKENS` (source
  of truth), `project_context._FEDERAL_STATE_TOKENS` (deliberate mirror, import
  cycle), `ris_adapter._FEDERAL_STATE_PARAMS` (RIS filter keys), and
  `intake-definition.ts` options. A parity test pinning the Python copies to
  `norm_registry` is the cheap guard.
- **`oib_knowledge` default — 6 sites:** NormsFile default, AT profile, three
  config YAMLs (`COLLECTION_NAME` fallback), and `collection-scope.ts`. The
  profile is the intended single source; config/env remain deploy-time
  overrides.

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

- Where the OIB table and the authentic gazette differ, RIS governs and the
  pack follows RIS, each corrected record citing its `LgblAuth` document (read
  2026-11-10 from `https://ogd.ris.bka.gv.at/Dokumente/LgblAuth/<ID>/<ID>.xml`).
  The OIB's values are the premises of the edition set's false-premise rows
  (`tests/fixtures/editions/at_edition_questions.yaml`, group `r5`):
  - Niederösterreich: LGBl. 41/2025 was published 2025-03-19 and is in force
    „am Tag der Kundmachung folgenden Tag", so 2025-03-20 (`LGBLA_NI_20250319_41`).
    The OIB's 2025-03-18 is the adoption.
  - Salzburg: LGBl. 83/2026 § 9 Abs 1 puts it in force on 2026-09-01, not the
    OIB's 2026-08-06, the day of publication. Its § 1 table binds OIB-RL 1–5 Mai
    2023 and **OIB-RL 6 März 2015** „gemäß Teil E der Anlage 1"
    (`LGBLA_SA_20260806_83`). The pack holds the 2015 edition from 2026-09-01;
    Teil E's deviations are not modelled, and the days before are not held, since
    the replaced LGBl. Nr 55/2016 was not read. Its text, like every 2019 and 2025
    one, is a manifestation under the name oib.or.at publishes; the upload to the
    base corpus is the operator's.
  - Burgenland: LGBl. 75/2026, published 2026-11-04, binds OIB-RL 6 „in der
    Fassung 2025" from the next day, 2026-11-05; RL 1–5 stay at 2019
    (`LGBLA_BU_20261104_75`). The OIB table still shows „-".
  - Wien: LGBl. 26/2026 replaces Anlage 13 of the WBTV 2023, which is OIB-RL 6
    Ausgabe September 2025, but it enters into force „mit dem Inkrafttreten des
    W-EGUG 2026", so the text itself does not confirm the pack's 2026-07-15
    (the OIB's day, kept). Pending procedures keep the earlier law
    (`LGBLA_WI_20260715_26`).
- The pack names no LGBl. for the Steiermark's StBTV 2020 or for Oberösterreich's
  RL 6 2019 adoption, and no adoption before 2019 in any Land.

| Land | Binding edition | In force since | Instrument |
|---|---|---|---|
| Wien | RL 1–5: 2023, RL 6: 2025 | 2024-02-23; RL 6 2026-07-15 | WBTV 2023 (LGBl. 14/2024), RL 6 by LGBl. 26/2026 |
| Niederösterreich | RL 1–6: 2023 | 2025-03-20 | NÖ BTV 2014 as amended by LGBl. 41/2025 |
| Oberösterreich | RL 1–5: 2023, RL 6: 2019 | 2025-10-01; RL 6 2020-09-01 | Oö. BauTV-Novelle 2025 (LGBl. 70/2025) |
| Steiermark | RL 1–6: 2019 | 2020-09-01 | StBTV 2020 |
| Kärnten | RL 1–6: 2023 | 2024-12-31 | K-BTV 2024 (LGBl. 105/2024) |
| Salzburg | RL 1–5: 2023; RL 6: März 2015 | 2026-09-01 | Sbg. BTV, LGBl. 83/2026 |
| Tirol | RL 1–5: 2023, RL 6: 2025 without Pkt 2.2 and 2.3.1 | 2026-07-16 | TBV 2026 § 43 (LGBl. 59/2026) |
| Vorarlberg | RL 1–6: 2019 | 2022-01-01 | BTV as amended by LGBl. 67/2021 |
| Burgenland | RL 1–5: 2019, RL 6: 2025 | 2021-04-10; RL 6 2026-11-05 | Bgld. BauVO 2008 as amended by LGBl. 22/2021; RL 6 by LGBl. 75/2026 |

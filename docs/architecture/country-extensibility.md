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
| Which edition binds at the site, and every edition's role | the same `knowledgeContext`: its `text` (the chain) and its `uses` (role, qualifier, `sourceRefs` as `{scheme, value}`), corrected for coverage, freshness and connecting factor. A use whose `applicability` is `check`, or has `open` building facts, gets no binding badge: the chain text says it neither binds nor does not bind until then (ADR-0178). There is no second answer: `buildingLaw` is gone | `citations/roles.py`, `common/law_gate.turn_building_law_block` |
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

Phase 2 — the source, as a record:
3. The country's legal database is a source record (ADR-0162), proposed in the
   country's change request as a platform record (ADR-0174), over an access
   type and a format engine that already exist. Code is written only for a
   protocol or a format nothing reads yet, once, named for the protocol or the
   format and never for the publisher or the country. `packages/ris-adapter` is
   not a template: it is the debt the [burn-down](#country-in-code-the-burn-down)
   lists first.

Phase 3 — vocabulary and language surfaces (scoped per country):
4. Document classification: `document_classification.py` tag vocabulary +
   German prompt ("österreichisches Architekturbüro") need per-country
   vocabulary/prompt variants.
5. Intake facts: `intake-definition.ts` carries AT-specific vocabularies
   (bundesland options, `building_class` GK1–5, `escape_level` >22m bands,
   `land_designation` options, the four AT boolean triggers) — country #2 needs its own
   question set; the intake machinery itself is versioned and generic.
6. Agent identity prompts: the j2 prompts hardcode "Austrian building
   regulations / RIS / OIB" framing — template off the profile
   (`country_name`, `legal_source_tools`) when country #2 ships.
7. Corpus filenames: `agent/common/oib_file_names.py` and the OIB readers in
   `norm_registry` (`oib_doc_class`, `oib_family_member`, `guess_display_title`)
   parse the OIB's filenames for a file's lane, class and title (a passage's
   edition and role no longer read them: `citations/roles.py` resolves by the
   record id the hit carries), from
   `agent/common/`, which should be country-neutral. Country #2's texts get their
   class and edition from the pack's manifestations instead, which is also the
   fix the name mapping bridges to (retrieval reading the chunk's `edition_id`).
8. Request envelope: its `federal_state` is AT-vocabulary. The agent no longer
   reads it for which law applies (the knowledge context's site does, ADR-0175);
   the RIS adapter still uses it to address a lookup to the right Land.

## Known duplications (consolidate opportunistically, never let them drift)

- **9-state vocabulary — 4 copies:** `norm_registry.BUNDESLAND_TOKENS` (source
  of truth), `project_context._FEDERAL_STATE_TOKENS` (deliberate mirror, import
  cycle), `ris_adapter._FEDERAL_STATE_PARAMS` (RIS filter keys), and
  `intake-definition.ts` options. A parity test pinning the Python copies to
  `norm_registry` is the cheap guard.
- **`oib_knowledge` default:** NormsFile default, three config YAMLs
  (`COLLECTION_NAME` fallback), and `collection-scope.ts`. One shared corpus
  holds every country; the knowledge context filters it by `country_id`.

## What is country-neutral already

Confirmed country-agnostic by inventory: collection layering and merging,
scoping headers, the request-envelope machinery, the classification and
compliance pipelines (mechanism, not vocabulary), "answer in the user's
language" prompt rules.

Nothing stays Austria-scoped on purpose. This section used to name the RIS
adapter package as "Austria's legal-database implementation, correctly
isolated"; ADR-0162 rejected one adapter per country, and the owner's rule
(2026-11-11) is that RIS as a name in code should not exist either.

## Country in code: the burn-down

A country is records, so a country's name, hosts, territories and laws in
source code are debt. `scripts/check_country_in_code.py` (the `country-in-code`
hook, in `task lint:repo` and CI's Repo checks) counts them per file against
`ci/country_in_code_baseline.json` and refuses a new one: a file may not grow, a
new file may not start above zero, and `--update` lowers an entry when a file
shrinks. The tokens are data, `ci/country_tokens.json`, whose `$comment` says
how to add a country; `tests/test_check_country_in_code.py` fails when a country
pack ships whose territories the list does not name.

What it counts: Python, TypeScript and JavaScript under `apps/` and
`packages/`, comments and docstrings left out, string literals and file and
directory names included; and every prompt whole, because the model reads it on
every turn and ADR-0168 requires the static prompt to be country-neutral: the
`.j2` templates, Markdown under a `prompts/` directory (`chat_static.md`, the
door's MCP prompts), the built-in `SKILL.md` files and the guides the agent
door serves. What it leaves alone, as data by nature: tests and fixtures, the
i18n dictionaries, the legal texts, the public site and its CMS, the component
gallery (`app/dev`), migrations and generated files (`platform-skills.ts` is
written from the `SKILL.md` files, which are counted). Documentation in Markdown
is prose about the code and is not counted. One thing it does not see and a
burn-down must: `configs/` itself, where a record that should be a platform
record is still a file.

Baseline, 2026-11-11: **2,090 hits in 302 paths**, 146 of them in 23 prompts.
Re-draw the table with
`.venv/bin/python scripts/check_country_in_code.py --summary`, and read one
file's hits with `--explain <path>`.

| Area | Paths | Hits | corpus_file_name | host | law_name | legal_database | standards_body | territory |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `apps/workspace/bff` | 88 | 473 | 3 | 5 | 13 | 93 | 173 | 186 |
| `packages/ris-adapter` | 17 | 401 | 0 | 3 | 8 | 356 | 3 | 31 |
| `apps/workspace/ui` | 41 | 277 | 3 | 3 | 1 | 105 | 145 | 20 |
| `apps/agent-host` | 24 | 209 | 0 | 0 | 0 | 43 | 149 | 17 |
| `packages/agent/src/agent/common` | 18 | 186 | 23 | 2 | 2 | 24 | 88 | 47 |
| `packages/agent/src/agent/agents` | 17 | 120 | 3 | 0 | 8 | 20 | 38 | 51 |
| `packages/agent/src/agent/knowledge` | 11 | 105 | 0 | 0 | 4 | 1 | 73 | 27 |
| `packages/agent/src/agent` (top level) | 7 | 91 | 0 | 0 | 0 | 0 | 64 | 27 |
| `packages/knowledge-layer` | 17 | 46 | 1 | 0 | 3 | 0 | 38 | 4 |
| `packages/agent/src/agent/skills` | 11 | 34 | 0 | 0 | 3 | 3 | 23 | 5 |
| `packages/agent/src/agent/tools` | 9 | 32 | 0 | 0 | 0 | 0 | 20 | 12 |
| `packages/public-sources` | 4 | 30 | 0 | 1 | 0 | 26 | 0 | 3 |
| `packages/agent/src/agent/cards` | 7 | 22 | 0 | 0 | 1 | 1 | 19 | 1 |
| `apps/workspace/app` | 7 | 20 | 0 | 0 | 0 | 15 | 5 | 0 |
| `packages/agent/src/agent/citations` | 8 | 16 | 0 | 0 | 0 | 11 | 4 | 1 |
| `packages/ifc-spatial-py` | 8 | 12 | 0 | 0 | 0 | 0 | 9 | 3 |
| the rest (7 areas) | 8 | 16 | 0 | 0 | 1 | 0 | 10 | 5 |
| **Total** | 302 | 2,090 | 33 | 14 | 44 | 698 | 861 | 440 |

The prompts, counted in the rows above, as a kind of their own:

| Prompts | Files | Hits | Becomes |
|---|---:|---:|---|
| Deep research templates (`agents/deep_researcher/prompts/*.j2`) | 5 | 52 | The works, sources and territories the run's knowledge context names, rendered in; the tool the template tells the model to call is the neutral legal-source lookup |
| Chat prompts (`chat_static.md` 11, `plan_generation.j2`, `research_clarification.j2`, the turn template) and the intake prompt | 5 | 39 | A static prompt that names no country (ADR-0168); every example an edition, a Land or a law comes from the turn's context |
| Built-in skills (`skills/builtin/**/SKILL.md`, the `oib/` directory among them) | 10 | 33 | Skills named for the subject (fire safety, building class) that ask the knowledge context which works bind at the site |
| The agent door (`door/guide.md`, `platform/onboarding-guide.md`, `prompts/building-law-check.md`) | 3 | 22 | Guides whose examples are a placeholder country, not Austria |
| **Total** | 23 | 146 | territory 57, standards_body 50, legal_database 26, law_name 10, corpus_file_name 3 |

The order below is by what a person in a second country meets first. None of
it is refactored by the change that added the check.

### 1. RIS as a name in code (708 hits, 100 paths)

`legal_database` (698: `ris` 686 as a word of an identifier, a route, a tool,
a string or a prompt, `LGBl` and `BGBl` 12) and the ten `bka.gv.at` hosts. The target is
that no code and no prompt names the publisher. Five parts, each with the paths
it touches:

| Part | Today | Becomes | Paths (hits) |
|---|---|---|---:|
| The source record | `configs/sources/at/ris/source.yml` and its two fixtures, a file in git; `at-ris` and its hosts as examples in the platform wire and catalog | A platform source record proposed in Austria's change request (ADR-0174), its fixtures with it; examples in descriptions name no real source | 7 (16), plus the 3 files under `configs/` |
| The adapter | `packages/ris-adapter` (19 source files, 15 test files), the `ris_xml` engine in `packages/public-sources/src/engines/`, the backend's `routes/ris.py` and the RIS halves of `routes/norms.py` and `plugin.py`, the BFF's `bff/ris/` and `/api/ris/document`, the UI's `ris-document-dialog` | The package goes away. The request side is the generic `rest` access type the record already configures. The format side is an engine named for the format (see below). Routes and the dialog are a source document by source id | 31 (481) |
| The model tool | `ris_lookup` and its three siblings (`ris_search`, `ris_fetch_document`, `ris_catalog_lookup`) as tool names, config keys (`ris.page_size`), limits, retrieval settings, step labels and `law_gate.LAW_SOURCE_COUNTRIES = {"ris": "AT"}` | One country-neutral legal-source lookup over the sources the turn's knowledge context names (ADR-0173); which source answers is the record's territory, not a table in `law_gate` | 17 (56) |
| Citations | `is_ris`, `isRisUrl`, `RIS_HOST_RE`, the `ris` origin and target kind, the `building_law_ris` lane, `RisPreviewChip`, the `[RIS]` tag in text parsers and report layout | A legal database is recognised by its source record and public address: roles, source identity, text parsers and verification ask the record, and the chip shows the record's title | 33 (129) |
| Prompts | The deep research templates tell the model to call `ris_lookup` and to cite RIS; the door's guides and three built-in skills name it | The prompt names the kind of source and the neutral tool; the turn's knowledge context names the source | 12 (26) |

Whether RIS can be read in a standard format, checked 2026-11-11 against the
OGD API v2.6 (`data.bka.gv.at`) and the fixture
`configs/sources/at/ris/fixtures/search_lrkons_wien.json`:

- **ELI: yes, as an identifier.** Every hit carries an `Eli` field
  (`https://www.ris.bka.gv.at/eli/bgbl/i/1997/55/P0/NOR11013163`,
  `https://ris.bka.gv.at/eli/lgbl/WI/1930/11/A1/LWI40000064`), so a work and a
  provision can be addressed through the `http_eli` access type that already
  reads Fedlex.
- **Akoma Ntoso: no.** A hit offers four content types, `Xml`, `Html`, `Pdf`
  and `Rtf`, and the XML is RIS's own schema: the root is `<risdok
  xmlns="http://www.bka.gv.at">` with `<nutzdaten>`, `<abschnitt>` and
  `<absatz>` (read from
  `https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen/NOR11013163/NOR11013163.xml`).
  The `akn` engine cannot read it.
- So a format parser stays, as format code with no Austrian logic: it parses
  `risdok` XML and the OGD search answer and holds no Land table, no
  application map and no host. Those are already the record's (`tables:` in
  `source.yml`). Today's engine is named `ris_xml`, which is the publisher's
  name; the schema's own name is the neutral one to take.

Status, 2026-11-11 (plan step 4a, #1624): the record carries its `lookup`
block (the locus grammar, the applications as collections, the Bundesland
filter, the words written back), a turn carries the released sources of its
countries, Austria's record is a door payload
(`configs/knowledge-packs/at-sources.json`), and the parity rig holds the
country-neutral lookup to the RIS tool's requests and text on 26 recorded calls
(`packages/agent/tests/knowledge/test_law_lookup_parity.py`). Step 4b renames
the model tool and deletes the package, `LAW_SOURCE_COUNTRIES` and the
repository file once the record is published on dev.

The constraint (ADR-0162, kept by ADR-0175): **Austrian answers stay
byte-identical.** `packages/ris-adapter/tests/test_source_record_parity.py`
holds every request the record builds to the request the code built, and the
record's fixtures (`.venv/bin/python -m public_sources test at-ris`) hold what
is read from the answers. Each part above moves with those tests green, and the
parity test moves with the request builder rather than being deleted with the
package.

### 2. The country and its Länder as literals (440 hits)

`territory`: Austria as a word 150 (`outside_austria`, `austrian_law`,
`AUSTRIA_BBOX`, prompts), Länder by name 147, `bundesland` as a word 82, the
country code as a quoted literal 45 (`=== 'at'`, `'AT'`), Land codes `AT-1`
to `AT-9` 16. This is what gives an office elsewhere Austria's
options or nothing.

| Where | Today | Becomes |
|---|---|---|
| `common/norm_registry.py` (43), `project_context.py`, `profile_names.py`, `ris-adapter/register.py` | The nine-state vocabulary in four copies (`BUNDESLAND_TOKENS` and its mirrors) | The pack's territory records, read through the knowledge context; a territory id, never a token list |
| `project-profile/intake-stages/project-basis.ts`, `documents/profile-contradictions.ts`, `site-resolution/parse.ts` | Länder as intake options and alias tables, `country === 'at'` gates | The site's setup records (ADR-0169): options and aliases are ruleset bodies; the gate is "the site's country has a record" |
| `geocoding/photon.ts`, `site-resolution/registers.ts` | `countrycode !== 'AT'`, an Austrian bounding box, register hosts | The registers a cell names for a country (ADR-0172) |
| `knowledge/permit_extraction.py`, `document_classification.py` | "österreichisches Architekturbüro" and Land names in prompt strings | The office's country and the site from the turn's knowledge context, rendered into the prompt |
| `bff/base-knowledge/consumers.ts` (14) | The consumer ledger cites each proving test by its title, and the titles name Wien and the WBTV | Last and cheapest: it falls when those tests are renamed for what they prove |

### 3. The OIB as a name in code (861 hits)

`standards_body`: the OIB is one standards body of one country, and it is in
module names, routes, document classes and rule ids.

| Where | Today | Becomes |
|---|---|---|
| `agent-host/routes/oib.py` (106), `agent/oib_status.py`, `agent/oib_sync.py`, the BFF's backend operations for them | `/v1/admin/oib/*`, `sync_oib_documents`, `OibFileState`: the base corpus named for its first publisher | The platform base corpus, per country: routes and modules named for the base corpus, the files a country's manifestations name |
| `knowledge/doc_class_vocabulary.py`, `bff/knowledge/doc-class.ts`, `bff/source-kinds.ts`, `ui/.../citations/model.ts`, `common/norm_registry.py` (61) | Document classes and lanes `oib_guideline`, `building_law_oib_*`, their labels ("OIB-Richtlinie") and `isOibBinding` | A work's `kind` and `designation` from the records; whether it binds is the relation the chain resolves (ADR-0168), never the class name |
| `bff/bim/rules.ts` (32), `packages/ifc-spatial-py` (9) | Rule ids `oib4-stair-rise-run-ratio`, `richtlinie: 'OIB 4'`, `appliesIn: 'AT'` | Rulesets run by the one evaluator (ADR-0166), selected by the site |
| The built-in skills under `skills/builtin/oib/` (23) and the prompts (50 in all), tool descriptions in `agent/tools` | OIB named in skill, prompt and tool text a model reads | Text that names the kind of source; the turn's knowledge context names the works |
| `oib_knowledge` as the collection default (three YAMLs, `collection-scope.ts`) | A collection named for one publisher | One shared corpus under a neutral name, filtered by `country_id` |

### 4. Corpus file names (33 hits)

`corpus_file_name`: `common/oib_file_names.py` (23) and its TypeScript twin in
`ui/.../document-names.ts` tie a passage to its edition by the spelling
oib.or.at publishes. Becomes the manifestation's `corpusFile` and the chunk's
`edition_id`; the mapping is the bridge until retrieval reads that, and then it
is deleted whole.

### 5. Law names (44 hits) and hosts (14 hits)

`law_name` (Bauordnung, WBTV, Baugesetz as examples in tool descriptions,
prompts and one citation regex in `knowledge-layer/src/references.py`) becomes
the works' designations from the pack, rendered where an example is needed.
`host` (`ris.bka.gv.at`, `oib.or.at`, `ma37.wien.gv.at` in citation targets,
the egress list and catalog examples) becomes the hosts of source records,
which the allowlist already reads (ADR-0174).

### What the count gets wrong

Measured on the baseline: every distinct identifier matched by `ris` (114
of them) and by the short Land and law codes was read, and 200 hits drawn at
random; none of those was a false positive. Two hits in 2,090 (0.1%) are known
false: a quoted `'at'` that is the English word (`agent-api/operation-search.ts`,
`documents/patch-engine.ts`). `'Europe/Vienna'` as the office time zone is
counted and is a true hit. The 146 hits in prompts were all read: each names
Austria, a Land, the OIB, RIS or a law.

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
    one, is a manifestation under the name oib.or.at publishes.
- **Upload, then publish.** Uploading a file to the base corpus does not tie it to
  its edition: the publish's index run does, re-ingesting each manifestation's
  `corpusFile` with its release's mark (`base-knowledge/platform/indexing.ts`). A
  publish whose file is missing fails that run („upload it, then publish again"),
  and a file uploaded after its release carries the unreleased mark `ZZ`
  (`UNRELEASED_COUNTRY`, the same file), which no office is entitled to, until a
  later publish indexes it. So upload
  the eleven 2019, 2025 and 2015 texts first, under their published names, then
  publish the change request that carries their manifestations.
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

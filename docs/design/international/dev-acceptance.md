# Dev acceptance: the country build, checked live

The fixed scenarios a QC agent runs on the dev stack after every merge of the country build (Wave 5 on, ADR-0168 to ADR-0176). Dev runs with every switch on for every organization ([build split](build-split.md), "Dev is the playground"). A scenario that fails is a regression: the next merge waits for its fix. Each run records the date, the deployed commit, and per scenario pass or fail with the exact question and a quoted excerpt of the answer.

The office is the test office on dev (WorkOS id `org_01KWEZPQ1B54E0KN9K838PCS89`). Two phases: **before** Austria's records are published (coverage `none`) and **after** (AT and EU stable, AT coverage `core`).

## Answers (`agent-ask-create`, then `agent-ask-get`)

*A1 to A8 are also golden cases (`at-a1-…` to `at-a8-…` in `configs/knowledge-packs/at-golden-cases.json`), so
`platform-knowledge-golden-run` scores them once they are published; a rule a phrase cannot tell (A4: "BayBO is
stated as a verified requirement") stays a reviewer's reading of the answer.*

The test office is entitled to AT only (`organization-countries-get`: home AT). Values come from the corpus or the records named in each row; a scenario fails on any **Fails if**, whatever else the answer gets right.

| # | Project and question | Passes if (before) | Passes if (after) | Fails if |
|---|---|---|---|---|
| A1 | Wohnhaus Kellermanngasse (1070 Wien): "Wie lang darf der Fluchtweg bis zum Treppenhaus höchstens sein?" | States 40 m (OIB-RL 2:2023, Punkt 5.1.1, from the corpus copy) and says which edition binds is not determined yet | States 40 m and names the edition the records make binding in AT-9 (the AT pack: OIB-RL 2:2023 through the WBTV 2023), with its role on the citation | A web copy of the OIB text is cited; the edition is called binding before the records are published |
| A2 | Kellermanngasse: "Welche Fassung der OIB-Richtlinie 2 ist in Wien verbindlich?" | Says it cannot be determined until Austria's base knowledge is published | OIB-RL 2:2023, binding in Wien since 23.02.2024, cited from the records | Any edition is named from a web page or from the product's own site |
| A3 | Wohnhaus Lindengasse (no site), the A1 question | Asks for the site (Land) | Same | A value is presented as this project's requirement; the answer assumes Austria |
| A4 | No project: "Welche Gebäudeklasse hat ein Wohnhaus mit 4 Geschoßen in München?" | Says the office's base knowledge does not cover Germany (gate `not_entitled` for DE, ADR-0173); any BayBO content is marked as unverified web information | Same | BayBO is stated as a verified requirement; Austrian law is applied |
| A5 | No project: "Was sagt § 50 Wiener Garagengesetz?" | Quotes § 50 from RIS | Same, with the role from the records | RIS is said to be off ("deaktiviert"); no RIS text is quoted |
| A6 | Kellermanngasse: "Welche Gebäudeklasse ist das?" | Derives no class and says why; the project profile may be quoted as the office's own statement | The class from the classification ruleset, with its citation | A class is derived before the records exist |
| A7 | A question answered by a licensed office document without AI attestation | Says the document is in the shelf, listed only, not read (ADR-0164) | Same | The document is said not to exist; its text is quoted |
| A8 | Kellermanngasse: "Welche Ausgabe der OIB-Richtlinie 2 galt für eine Einreichung am 01.06.2023?" (the submission date is the reference date) | Says it cannot be determined without the records | OIB-RL 2:2019, in force in Wien from 01.02.2020 to 22.02.2024 | The current edition is given for a 2023 submission |

Every answer, whatever the scenario, fails if:
- an internal error text, a tool name or a raw verification marker (e.g. "(citation not verified)") appears;
- confidence is `high` while its reason names an unchecked gap;
- a web copy of a norm the corpus holds is cited;
- the product's own site is cited as a source for law.

## Doors

| # | Check | Expected |
|---|---|---|
| D1 | Any operation behind a switch that is off | One RFC 9457 problem, `code: feature_disabled`, naming the switch |
| D2 | `platform-knowledge-schema-get` | Lists every proposable type, `relation` included, the same set `records-propose` accepts |
| D3 | `coverage-get` with no query | Answers for every entitled country |
| D4 | `classification-evaluate` while the gate withholds law | `undetermined` with the gate's reason, never a value |
| D5 | `site-resolve` before the register import | `unverified`, `no_register`, no error |
| P1 | A request approved alone (ADR-0176) | Marked as approved alone on the request and its releases, audited, with an open second-review item |
| P2 | Capture of a public PDF on a source's host, then a record quoting page 2 | KC-6 passes |

## Run of 2026-11-12: Austria after coverage `core`

Austria stable on dev from `5907f5cb` and `d76b4ca3` (coverage `core`), release sequence 636 (312 records, 49 texts), checked by the QC lane through the platform door and the office door. The release was read whole with `platform-knowledge-release-export` and compared with `configs/knowledge-packs/at.json` and the OIB adoption table captured in the release (capture `bf60da70…`, "Stand: Oktober 2026").

### Live answers (Graz, Wien, Salzburg, Innsbruck; stairs, fire protection, U-value)

The values were checked against the PDFs: OIB-RL 4 Tabelle 3 (18/27 cm, Wohnungstreppe 20/24), OIB-RL 2:2023 Tabelle 1b GK 4 (R 30 top storey, R 60 other above-ground storeys), and OIB-RL 6 walls against outside air 0,35 W/(m²K) in the 2015, 2019, 2023 and 2025 editions.

| Land | Stairs | Fire protection GK 4 | U-value wall |
|---|---|---|---|
| Steiermark (Graz) | 2019, values right, high | 2019, right, **medium** ("no RIS proof") | 2019, right, high |
| Wien | 2023, right, high **with an open point in its reason** | 2023, right, **medium** | 2025, right, **medium** |
| Salzburg | 2023, right, high **with an open point** | 2023, right, **low** | 2015, right, **medium** |
| Tirol (Innsbruck) | 2023, right, high | 2023, right, **medium** | 2025, right, high **with an open point** |

Binding edition right in 12 of 12, values right in 12 of 12. Confidence fails 9 of 12: six fall to medium or low because the answer says the binding declaration "was not checked against its source", and three are `high` with a reason that names an open point (the dev-acceptance "Fails if" for every answer).

### The binding matrix, as released

What binds on 2026-11-12, read from the release's `makes_binding` relations and checked against the OIB adoption table and RIS (RIS wins where they differ):

| Land | OIB-RL 1 to 5 | OIB-RL 6 |
|---|---|---|
| Burgenland (AT-1) | April 2019, since 10.04.2021 | September 2025, since 05.11.2026 (RIS; the OIB table still shows none) |
| Kärnten (AT-2) | Mai 2023, since 31.12.2024 | Mai 2023, since 31.12.2024 |
| Niederösterreich (AT-3) | Mai 2023, since 20.03.2025 (RIS) | Mai 2023, since 20.03.2025 |
| Oberösterreich (AT-4) | Mai 2023, since 01.10.2025 | April 2019, since 01.09.2020 |
| Salzburg (AT-5) | Mai 2023, since 01.09.2026 (RIS, LGBl 83/2026) | März 2015, since 01.09.2026; before that a gap (finding 8) |
| Steiermark (AT-6) | April 2019, since 01.09.2020 | April 2019 |
| Tirol (AT-7) | Mai 2023, since 16.07.2026 | September 2025, since 16.07.2026, with deviations from Pkt. 2.2 and 2.3.1 |
| Vorarlberg (AT-8) | April 2019, since 01.01.2022 | April 2019 |
| Wien (AT-9) | Mai 2023, since 23.02.2024 | September 2025, since 15.07.2026 |

### Findings

| # | Finding | Evidence | Fix | Owner |
|---|---|---|---|---|
| 1 | Every platform edition counts as never checked, so every AT turn tells the model to say so, and confidence drops | Only office copy checks are ever written (`bff/base-knowledge/store/repository.ts`, `writeConfirmedValues`, `insertCopyCheck`); no code writes a platform `knowledge_checks` row on an edition. `context/resolve.ts` `freshnessOf` then labels every use `check_overdue` and `unchecked_since`, and `chain/text.ts` `noteWords` writes "never checked against its source by the platform: say so". The answers above repeat it. `platform-knowledge-overview-get` `overdueEditions: 54` is this same count (`platform/freshness.ts`: never checked counts as overdue): correct by its definition, all 54 editions | A check asserts one thing and is recorded only when it ran: the text the platform holds is the one its source serves now (the sha256 of a fresh fetch of the manifestation's URL equals the released text's), and for a binding, that the adopting act's page still reads as captured. A publish is not a check. Until a check really ran, the "never checked against its source" line stays true and stays in the answer; it must not be hidden to raise confidence | Owner (decision), then a PR: a check operation and a monitor that write `knowledge_checks` |
| 2 | A released text is cited by its file name, and the chip says "in: Rechtsinformationssystem des Bundes (RIS)" for an OIB PDF | `oib-rl-6-2025-text-bc35d3dee230.pdf, … in: Rechtsinformationssystem des Bundes (RIS).` beside `OIB-Richtlinie 4, Ausgabe Mai 2023, … (Österreichisches Institut für Bautechnik, Wien).` for the legacy copy. `guess_display_title` and `oib_doc_class` read no `<key>-<hex>.pdf` name | Title: #1682 stamps it at publish. The 49 texts already released on dev need `platform-knowledge-title-update` once. Citation line: with the step-9 lane (#1680) | QC lane (#1682), step-9 lane |
| 3 | Released texts carry doc class `other`; a search filtered by doc class (`oib_guideline`) finds only the legacy copies | `platform-knowledge-base-get`: every `<key>-<hex>.pdf` is `docClass: other`, most with a `docClassSuggestion`. The filter runs in `vector_store/prefilter.py`. Roles do not depend on it (they come by edition id, `citations/roles.py`) | Set each text's doc class (`platform-knowledge-doc-class-update`), a person's acceptance per ADR-0064, **before** the legacy copies go. The vocabulary is OIB-specific, which is the country-in-code debt for later | Owner |
| 4 | 22 legacy files are byte-identical to released texts | sha256 of the bytes (`platform-knowledge-document-get`, hashed locally) equals the released text's: the 15 `oib-rl_*_ausgabe_mai_2023.pdf` (RL 1, 2, 2.1, 2.2, 2.3, 3, 4, 5, 6, the Leitfäden of RL 1, 2 and 6, Begriffsbestimmungen, Zitierte Normen and its Rev. 1) and `erlaeuterungen_oib-rl_{1,2,2.1,2.2,2.3,3,4}_ausgabe_mai_2023.pdf`. The legacy Erläuterungen of RL 5 and 6 equal the orphan texts that `c72e03ea` attaches | Delete on dev after findings 2 and 3 (else every OIB citation and doc-class search gets worse); the delete asks the person (elicitation). **Nothing was deleted on 2026-11-12**: the first delete's question got no answer. On prod they stay until AT is stable there (`rollover-to-prod.md`, open question 2) | Owner |
| 5 | Five Erläuterungen manifestations were released with no text, and their PDFs sat in the corpus marked with no country | `manifestation:oib-rl-5-erlaeuterungen-{2019,2023}-text`, `oib-rl-6-erlaeuterungen-{2019,2023,2025}-text` with `corpusFile: null` | Draft `c72e03ea` re-proposes them and attaches the same bytes (`stored: false`), validated and submitted | Owner (review, publish) |
| 6 | AT had no golden cases on the platform, so no golden run was possible | `golden_case` records: none released | Draft `9dd4d3f0`: the 28 cases of `configs/knowledge-packs/at-golden-cases.json`, cited from fetched captures (OIB page, RL 2 and 3 2023, Begriffsbestimmungen 2023, RL 6 2025, RIS BO für Wien, WGarG 2008, Stmk. BauG) and, for the seven with no legal source, from operator-supplied captures of this file and `quality-and-cost.md` | Owner (review, publish), then the golden run |
| 7 | The binding matrix holds; the expectation that Kärnten binds 2019, Burgenland 2023 and Oberösterreich RL 6 2023 is wrong | The release equals `at.json` relation for relation (only the 12 `interprets` relations are added) and the OIB table: Kärnten 2023 from 31.12.2024, Burgenland RL 1–5 2019 (RL 6 2025 from 5.11.2026, RIS), Oberösterreich RL 1–5 2023 from 1.10.2025 with RL 6 still 2019, Steiermark and Vorarlberg 2019, Wien and Tirol RL 6 2025, Salzburg RL 6 2015 | None | — |
| 8 | Salzburg RL 6 has no binding edition before 2026-09-01 | The only AT-5 RL 6 relation is `oib-rl-6-2015` from 2026-09-01. RIS: § 1 of the Salzburger Bautechnikverordnung, LGBl Nr 55/2016, names OIB-RL 6 "März 2015" both as in force on 01.07.2016 (LSB40018643) and from 01.10.2021, when RL 1 to 5 moved to April 2019 (LSB40025331); LGBl 83/2026 repeals it on 01.09.2026 | Draft `b79ef256` (submitted, validated): relation `at-5-oib-rl-6-2015-sbtv-2016`, `sbg-btv` makes OIB-RL 6:2015 binding from 2016-07-01 to 2026-09-01, cited from both RIS captures and the OIB table | Owner (review, publish) |
| 9 | Small data gaps | `oib-zitierte-normen-2023-rev-1` has no `issuedOn`; `oib-rl-6-2025` is labelled "Ausgabe 2025" where its siblings say "Ausgabe September 2025"; `oib-rl-7-grundlagendokument-2023` is labelled "Ausgabe: Mai 2023" (colon). Labels become citation titles, so these show in answers; `inForceFrom` is null on all 54 editions (bindings carry the dates, so no answer depends on it) | The first two in the next AT request | Owner |
| 10 | RIS gives no text for today in Salzburg and Tirol, or a TBV 2026 "Fassung 2016-05-01" | The Salzburg and Innsbruck answers above | Look at the RIS lookup's date handling for Landesrecht in force in 2026 | Step-9 lane |
| 11 | The Änderungen (redline) files are not put in a request | A manifestation is `form: text | link` of an edition: a redline attached to a 2023 edition would be a second binding text of it, its struck wording cited as binding, and its new file name would leave the retrieval exclusion (`knowledge_search.exclude_file_names`) | Keep them excluded; if they are wanted, model them as their own commentary works with no binding route | Owner |
| 12 | An agent could not list the corpus past 40,000 characters | `platform-knowledge-base-get` took no filter and answered 62,003 characters | #1684: `nameContains`, `countryId`, `brief`, `limit`, `cursor` | QC lane (#1684) |
| 13 | Three answers are `high` with a reason naming an open point (Wien and Salzburg stairs, Innsbruck U-value), which the acceptance and the golden cases count as a failure | The model writes a project-level unknown ("Treppenart nicht bestätigt", "RIS-Fassungsdatum widersprüchlich") into the reason while keeping `high`; the answer check (`confidenceCheck`) judged `high` with no findings. The prompt says medium "for a named gap" (the agent's static prompt, `chat_static.md`, `confidence`) but nothing holds the reason to the level | Say in the prompt what belongs in a `high` reason (what supports the answer) and that a fact the question leaves open goes in the prose, then measure it with the answer suite before and after (it is blocked on OpenRouter credit, see #1680) | Step-9 lane or QC lane, after the suite runs |
| 14 | Burgenland (Eisenstadt), balcony guard and „which edition of OIB-RL 4 applies here since when": every statement right (1,00 m, 1,10 m above 12 m fall height; RL 4 April 2019 since 10.04.2021), confidence **low**. Not finding 1 (the answer carries no "never checked" line, and the RL 6 changeover of 05.11.2026 is not on this question's path), not finding 13 | The answer check (`confidenceCheck`, `status: judged`, level `low`) named two findings, both the binding edition: the date and LGBl. 22/2021 unbacked because the cited RIS passage is § 43 Bgld. BauVO in its 2016 wording, and „Mai 2023 binds not here" unbacked with `source: none`. The answer took both from the `<building_law>` block; the grader was never handed it (`answer_check.turn_check` passed the profile and the inventory only). The `answerConfidenceReason` the door shows ("…die tatsächliche Absturzhöhe ist nicht bekannt") is the model's self-report, which sets no level; the chip shows the findings. Conversation `s_00411f90_…`, answer `585ddd7a…` | The check now reads the turn's `<building_law>` block (ADR-0139, amendment of 2026-11-12). The RIS lookup serving § 43 as of 2016 for a 2021 in-force clause belongs to finding 10. Re-ask on dev after deploy; the live harness measures the grading | Step-9 lane (#10), owner (re-ask) |
| 15 | A question naming a day got today's chain only: in Eisenstadt (AT-1) "Welche Ausgabe der OIB-Richtlinie 6 galt für eine Einreichung am 1. Oktober 2026, und welche gilt für eine Einreichung heute?" named September 2025 since 05.11.2026 for today and "nicht bestimmbar" for 1.10.2026, where the records bind April 2019 until 05.11.2026. A8 fails the same way in a project with no filing day | The turn's context resolves on today or a filing day that has come (`context/service.ts`, `referenceDateOf`); the agent called `base-knowledge-edition-as-of`, which reads only the work's own edition dates (`time/editions.ts`, `edition_dates_unknown`: `inForceFrom` is null on every OIB edition, finding 9) and never the Land's `makes_binding` relation | `project-base-get` takes `asOf` and resolves the project's context on that day, labelled with it; the static prompt names it for a day the question names, and the as-of operation's description points to it (`claude/as-of-date-chain`). Live after `task prompts:push -- --apply` | QC lane |
| 16 | The day a binding holds from was cited from the web, though the records held it | Kaiserstraße 43 (Wien), "… welche Ausgabe der OIB-Richtlinie 4 gilt hier seit wann?" (answer `558f2d73…`): "seit 23. Februar 2024 … [2] RIS § 5; das Datum bestätigt die Kammer der Ziviltechniker:innen [3] [Web] ost.zt.at newsletter". Relation `at-9-oib-rl-4-2023` holds `validFrom` 2024-02-23, and the turn's use carried it as `roleSince`, but only the citation line read that field: the chain text the model reads (`chain/text.ts` `bindingLine`) named the edition and its route with no day. The model spent two more rounds on RIS § 5 ("am Tag nach der Kundmachung", no date) and a web search. `law-cited-from-web` read 0: it counted only a page that copies or names a held work in its own title or address, and `sentences` cut "23. Februar" at its dot, so the sentence naming the work lost its citations. The answer check marked the day unbacked: it reads the profile and inventory, not the building-law block | The chain text states the day on each binding line ("since 2024-02-23", `roleSinceOf`, one derivation with the citation line) and says once that the day is the records' own. `law-cited-from-web` also counts a web page cited by a sentence that names a held work; a written date no longer ends a sentence. Open: the answer check does not read the building-law block, so a binding day stated from the records still reads as unbacked to it | This branch (`claude/records-over-web`); the judge's evidence is the owner's decision (ADR-0139) |

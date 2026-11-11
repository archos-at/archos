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

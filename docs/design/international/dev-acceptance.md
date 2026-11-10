# Dev acceptance: the country build, checked live

The fixed scenarios a QC agent runs on the dev stack after every merge of the country build (Wave 5 on, ADR-0168 to ADR-0176). Dev runs with every switch on for every organization ([build split](build-split.md), "Dev is the playground"). A scenario that fails is a regression: the next merge waits for its fix. Each run records the date, the deployed commit, and per scenario pass or fail with the exact question and a quoted excerpt of the answer.

The office is the test office on dev (WorkOS id `org_01KWEZPQ1B54E0KN9K838PCS89`). Two phases: **before** Austria's records are published (coverage `none`) and **after** (AT and EU stable, AT coverage `core`).

## Answers (`agent-ask-create`, then `agent-ask-get`)

| # | Project and question | Expected before | Expected after |
|---|---|---|---|
| A1 | Wohnhaus Kellermanngasse (1070 Wien): "Wie lang darf der Fluchtweg bis zum Treppenhaus höchstens sein?" | 40 m as an orientation value from the corpus copy of OIB-RL 2, and says the binding edition is not determined yet | 40 m, with OIB-RL 2:2023 named binding in Wien through the WBTV 2023, the role shown on the citation |
| A2 | Kellermanngasse: "Welche Fassung der OIB-Richtlinie 2 ist verbindlich?" | Says it cannot be determined because Austria's base knowledge is not published; no edition taken from a web page | OIB-RL 1–5 2023 binding in Wien since 23.02.2024 and RL 6 2025 since 15.07.2026, cited from the records |
| A3 | A project with no site (Wohnhaus Lindengasse), the A1 question | Asks for the site; no value presented as the project's requirement; nothing "assuming Austria" | Same |
| A4 | No project: "Welche Gebäudeklasse hat ein Wohnhaus mit 4 Geschoßen in München?" | Says Germany is not in the base knowledge; any BayBO content labelled unverified information from the web; no Austrian law | Same |
| A5 | No project: "Was sagt § 50 Wiener Garagengesetz?" | Reads RIS and quotes it; never "deaktiviert" | Same, with the role from the records |
| A6 | Kellermanngasse: "Welche Gebäudeklasse ist das?" | No class derived, with the reason; the project profile may be quoted as the office's own statement | The class from the classification ruleset, with its citation |
| A7 | A licensed office document without AI attestation in the office shelf: a question it would answer | Says the document is in the shelf and listed only, not read | Same |
| A8 | Kellermanngasse: "Welche Ausgabe galt für ein Einreichung am 01.06.2023?" | Not determinable without the records, said plainly | OIB-RL 2019 (in force in Wien 01.02.2020 to 22.02.2024), from the reference-date rule |

Every answer, whatever the scenario:
- **No internals:** no internal error text, tool name or raw verification marker such as "(citation not verified)" appears.
- **Honest confidence:** it is never `high` while the reason names an unchecked gap.
- **No copies:** no web copy of a norm the corpus holds is cited.
- **No product sites:** the product's own sites are never a source for law.

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

# Answer quality and cost: the plan after Wave 5

Written 2026-11-10. It rests on two dated research reports. Neither has evidence older than five months, and the prompting advice is no older than three:

- [`research/market-2026-11.md`](research/market-2026-11.md): who else answers building-law questions for planning offices, what they do well, what practitioners distrust, and fifteen requirements in testable form (R1–R15).
- [`research/token-budget-2026-11.md`](research/token-budget-2026-11.md): Anthropic's and OpenRouter's current guidance on prompts, caching, context and tools. It measures where a chat turn spends its tokens, ranks the changes, and adds a model choice per role.

The user's bar is that the result must be better in every way: in the answer, in what it costs and in how long it takes. A change that improves one of these and worsens another does not count as done.

## The star

An architect in Graz asks a question about the project in front of them. The answer they get:

- names the Land and the OIB-RL edition that binds on the project's reference day, the LGBl that makes it binding, and its in-force date;
- shows the passage directly under each claim, with a link to the RIS Fassung;
- corrects a wrong premise instead of following it;
- says plainly what it could not check, without guessing;
- costs a median of €0.05 or less and arrives faster than today.

Nobody else in the market does the first point. Austria is close to uncontested ([market report, (a) and (c)](research/market-2026-11.md)). Competitors are ahead on the second and on flat pricing.

## Where we stand (measured, not assumed)

- **Quality.** The before-baseline is 20 fixed questions (B1–B20, [below](#the-before-baseline-2026-11-10)), asked through the agent door on dev on the old path on 2026-11-10, between 17:17 and 17:23 UTC. The old path was confirmed by `coverage-get` answering 403 `feature-disabled` before the first ask and after the last. Every one was answered. The QC runs and the baseline show these faults:
  - **High confidence despite open gaps**: B1, B9, B10 and B11.
  - **Law chosen from an unconfirmed site in project memory**: B3.
  - **Web-only or unofficial sources**: B4, B14 and B16.
  - **A research limit hit after 30 retrieval calls**: B14.

  Fixing these is R1's QC list in Wave 5.
- **Latency.** On that baseline, answers took between 12.7 s and 83.7 s (median about 39 s).
- **Cost.** A routine answer on `openai/gpt-6.1-terra` comes to about €0.11. That figure is modelled from the measured profile in [`llm-providers.md`](../../architecture/llm-providers.md); the suite has not measured it. Input tokens are about 98 % of a turn's cost. The static prefix (tools and system) is 23–31k tokens on every call, and a whole turn's cache carries almost nothing into the next turn ([token report, "Where a chat turn spends tokens"](research/token-budget-2026-11.md)).

## The slices

Each slice names the part of the star it serves. None ships on opinion: each is measured with `task be:eval:answer-suite` before and after. The suite needs credit on the OpenRouter key; until a person adds it, a slice can be built and tested, but not called better.

**Q1: the prefix is cached, so a turn pays for what is new** (serves the €0.05 bar, and latency through cache reads). Changes 1–7 of the token report, in its order:
- an explicit cache breakpoint at the end of the static system block, with the main role taken off the Responses API so that the breakpoint reaches the provider;
- `cache_write_tokens` recorded in the ledger and in Langfuse;
- history edited in batches, with ADR-0154's stable head landed;
- no cache writes on one-shot calls;
- the IFC and DXF tools bound only where the project holds a model;
- the `calculation`/`formula` card shapes taken out of the static prompt;
- the same tool binding kept through forced synthesis.

A test pins the size of the static prefix, so it cannot creep back. Modelled: about €0.11 → about €0.068 per routine answer from Q1 alone; with Q3 moving the post-answer roles off terra, about €0.047 (token report, (d)).

*Built 2026-11-10 on `claude/intl-q1-prefix-cache`, the suite run outstanding (the suite's key had no credit).* What landed and where: the breakpoint in `common/prompt_caching.py`, with `research_llm` on Chat Completions; `cache_write_tokens` through the ledger (migration 0214), Langfuse and the PostHog usage events; the stable head and the stepped history edits as [ADR-0177](../../adr/0177-what-the-project-and-the-office-set-goes-at-the-head-of-a-chat-request.md) (drafted as ADR-0154 on the unmerged branch, whose number was taken); `prompt_caching.one_shot_calls` around the claim judge, the memory judges, the follow-ups and the RIS planner; `projectModels` on the turn context and `turn_tools.tools_in_scope`; an empty `ENVELOPE_SHAPE_TYPES`; `envelope_call.ainvoke_synthesis`. The static prefix measured after it, o200k: system prompt 8,110, tools 20,418 (10,360 in a project without a model), pinned in `test_static_prefix_size.py`.

**Q2: the Austrian golden set** (serves the first five points of the star and makes them measurable). Market requirements R1, R2, R3 and R5 become question sets in the suite:
- 54 items for Land × OIB-RL edition;
- the paired changeover days (Wien RL 6 on 14/15 July 2026; Salzburg RL 2 on 5/6 August and 31 August/1 September 2026, because RIS puts LGBl. 83/2026 in force on 1 September, not on the OIB table's 6 August);
- 20 abstention items;
- at least 30 false premises.

The expected values come from the published records and their RIS captures, never from memory. Where the OIB table and RIS disagree, RIS wins and the item cites it. Built as `--set editions` (`tests/fixtures/editions/at_edition_questions.yaml`, 134 items). The pack was corrected to RIS for Salzburg, Niederösterreich and Burgenland, and the OIB table's values became false premises. The research found no building-code QA benchmark published in its window, so this set would be the first public one we know of.

**Q3: model choice per role, confirmed by the suite** (serves cost without giving up quality). Keep `gpt-6.1-terra` at medium for the answer. Test Haiku 5.5 against `gpt-6-luna` for the clarifier, router, memory and follow-up roles. Test Sonnet 5.5 against `gpt-6.1-sol` for ingest vision. Each is one variable per run, with the exact overrides in the token report, (d). A model moves only through Platform → Models after the suite shows no question got worse. The YAML is never the place to move it.

**Q4: the passage under the claim** (serves the second point of the star, R9). It comes after Q1–Q3.

## Not now

- R10, findings tracked across model revisions, comes after the cut-over.
- R15, Germany and the EU on the same contract, comes when each country is onboarded.

## The before-baseline, 2026-11-10

Asked through the agent door on dev, one org, old path (the knowledge-context switches off for that org only). "Retrieval calls" counts the answer's retrieval tool calls from its message metadata; token usage per answer is not available on the door (`conversation-message-usage` is withheld as billing) and comes from the answer suite instead. The after-run asks the same 20 questions in the same projects.

| # | Question | Project | Seconds | Confidence | Sources | Retrieval calls |
|---|---|---|---|---|---|---|
| B1 | Wie lang darf der Fluchtweg bis zum Treppenhaus höchstens sein? | yes | 36.3 | high | 3 | 11 |
| B2 | Welche Fassung der OIB-Richtlinie 2 ist in Wien verbindlich? | yes | 44.1 | medium | 5 | 8 |
| B3 | Wie lang darf der Fluchtweg bis zum Treppenhaus höchstens sein? | yes | 34.2 | low | 1 | 4 |
| B4 | Welche Gebäudeklasse hat ein Wohnhaus mit 4 Geschoßen in München? | no | 59.4 | low | 2 | 7 |
| B5 | Was sagt § 50 Wiener Garagengesetz? | no | 12.7 | high | 1 | 2 |
| B6 | Welche Gebäudeklasse ist das? | yes | 26.3 | high | 3 | 6 |
| B7 | Welche Brandabschottung ist für Leitungsdurchführungen laut unserer Büroablage vorgesehen? | yes | 14.2 | high | 1 | 1 |
| B8 | Welche Ausgabe der OIB-Richtlinie 2 galt für eine Einreichung am 01.06.2023? | yes | 45.1 | low | 4 | 13 |
| B9 | Wie viele Pflichtstellplätze brauchen 12 Wohnungen hier? | yes | 34.6 | high | 3 | 8 |
| B10 | Welche Feuerwiderstandsklasse brauchen tragende Wände in Gebäudeklasse 4? | yes | 43.6 | high | 1 | 7 |
| B11 | Ab wie vielen Geschoßen ist ein Aufzug Pflicht? | yes | 33.9 | high | 3 | 6 |
| B12 | Welcher Abstand zur Nachbargrundgrenze ist einzuhalten? | yes | 16.9 | high | 1 | 2 |
| B13 | Welche Ausgabe der OIB-Richtlinien ist in der Steiermark verbindlich? | yes | 50.7 | medium | 2 | 11 |
| B14 | Welche Ausgabe der OIB-Richtlinien ist in Salzburg verbindlich und seit wann? | yes | 83.7 | low | 3 | 30 |
| B15 | Welcher U-Wert gilt für eine Außenwand im Neubau? | yes | 61.1 | medium | 2 | 12 |
| B16 | Wie groß müssen die Abstandsflächen sein? | yes | 56.2 | low | 1 | 7 |
| B17 | Was ist der Unterschied zwischen OIB-Richtlinie 2 und 2.3? | no | 18.6 | medium | 5 | 6 |
| B18 | Welche Mindestraumhöhe brauchen Aufenthaltsräume? | yes | 33.6 | medium | 7 | 8 |
| B19 | Welche Unterlagen brauche ich für eine Baueinreichung in Wien? | no | 37.7 | medium | 5 | 6 |
| B20 | Ab wann gilt die OIB-Richtlinie 6 Ausgabe 2025 in Wien? | yes | 46.7 | — | 2 | 15 |

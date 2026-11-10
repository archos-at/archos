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

- **Quality.** The before-baseline is 20 fixed questions, asked on dev on the old path on 2026-11-10. Every one was answered. The QC runs and the baseline show these faults:
  - **High confidence despite open gaps**: Q1, Q9, Q10 and Q11.
  - **Law chosen from an unconfirmed site in project memory**: Q3.
  - **Web-only or unofficial sources**: Q4, Q14 and Q16.
  - **A research limit hit after 30 retrieval calls**: Q14.

  Fixing these is R1's QC list in Wave 5.
- **Latency.** On that baseline, answers took between 12.7 s and 83.7 s.
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

A test pins the size of the static prefix, so it cannot creep back. Modelled: about €0.11 → about €0.047 per routine answer.

**Q2: the Austrian golden set** (serves the first five points of the star and makes them measurable). Market requirements R1, R2, R3 and R5 become question sets in the suite:
- 54 items for Land × OIB-RL edition;
- the paired changeover days (Wien RL 6 on 14/15 July 2026, Salzburg RL 2 on 5/6 August 2026);
- 20 abstention items;
- at least 30 false premises.

The expected values come from the published records and their RIS captures, never from memory. Where the OIB table and RIS disagree, RIS wins and the item cites it. This is the first public building-code benchmark the research found anywhere.

**Q3: model choice per role, confirmed by the suite** (serves cost without giving up quality). Keep `gpt-6.1-terra` at medium for the answer. Test Haiku 5.5 against `gpt-6-luna` for the clarifier, router, memory and follow-up roles. Test Sonnet 5.5 against `gpt-6.1-sol` for ingest vision. Each is one variable per run, with the exact overrides in the token report, (d). A model moves only through Platform → Models after the suite shows no question got worse. The YAML is never the place to move it.

**Q4: the passage under the claim** (serves the second point of the star, R9). It comes after Q1–Q3.

## Not now

- R10, findings tracked across model revisions, comes after the cut-over.
- R15, Germany and the EU on the same contract, comes when each country is onboarded.

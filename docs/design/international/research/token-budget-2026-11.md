# Anthropic and OpenRouter guidance, and where an chat turn spends its tokens

Consultant report, written 2026-11-10. Read-only: nothing in the repo was changed, nothing was pushed, and no production system was called. Branch read: `claude/intl-dev-acceptance` at `79881d656`.

**How tokens were counted.** Anthropic's token-counting API was not available, so every count below is **tiktoken `o200k_base`** (tiktoken 0.13 from the repo venv). That is the GPT tokenizer. Claude's tokenizer (the one Opus 4.7 introduced, used by the 5.5 family) gives different counts, and German text usually comes out higher. Where a Claude cost depends on it, the report assumes **×1.15** and says so. The measuring scripts lived in the consultant's session and are not kept; slice Q1 of [`quality-and-cost.md`](../quality-and-cost.md) turns the static-prefix count into a test.

**How sources are dated.** Anthropic and OpenRouter docs pages carry no date of their own. Each is dated "on or after" the release date of the newest model the page names, taken from the dated Anthropic release notes. For example, a page that names Claude Fable 5.2 was last edited on or after 2026-11-09. A page with no such anchor was dropped.

---

## (a) Sources, with dates

Windows: advice on prompts, tool descriptions and context must be dated **on or after 2026-08-10** (3 months). Everything else must be dated **on or after 2026-06-10** (5 months).

### Anthropic: prompting, tools, context (3-month window)

| # | Source | Date | Used for |
|---|---|---|---|
| A1 | [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | ≥ 2026-11-09 (names Fable 5.2) | explain the reason behind an instruction; long material above the query; soften aggressive language; *pass thinking blocks back unchanged and keep history append-only* (migration item 7) |
| A2 | [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) | ≥ 2026-09-22 | effort starts at `medium` (the default); remove think-carefully lines from chat prompts; the "treat earlier answers as settled" line |
| A3 | [Prompting Claude Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5) | ≥ 2026-09-28 | chat starts at `medium`/`low`; JSON output on reasoning tasks; remove "minimize tool calls" language |
| A4 | [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) | ≥ 2026-11-09 | detailed descriptions; consolidation; responses that return only high-signal fields |
| A5 | [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) | ≥ 2026-11-09 | use it at 10 or more tools or more than 10k tokens of definitions; selection accuracy drops past 30–50 tools; a custom client-side search is allowed |
| A6 | [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | ≥ 2026-11-09 | **cache entries are written only at breakpoints**; reads look back at most **20 blocks**; order is tools → system → messages; a change to a tool invalidates everything; `tool_choice` or image changes invalidate the messages; automatic caching plus explicit breakpoints share 4 slots |
| A7 | [Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics) | ≥ 2026-11-09 (GA 2026-09-23, release notes) | finding where a prefix diverged (first-party API only) |
| A8 | [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | ≥ 2026-11-09 | clearing invalidates the cache, so clear enough at once (`clear_at_least`); client edits to earlier turns invalidate later thinking blocks |
| A9 | [Compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand) | ≥ 2026-11-09 (beta 2026-09-14) | compaction instead of rewriting history in place |
| A10 | [Mid-conversation system messages and tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) | ≥ 2026-11-09; `clear_at` beta 2026-09-01 | turn-scoped system messages: render for one turn, then stay in history at no cost and keep the cache |
| A11 | [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking) | ≥ 2026-11-09 | the prefix check on Opus 5.5, Sonnet 5.5 and Haiku 5.5 |
| A12 | [Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) | ≥ 2026-11-09 | caching comes first; **below about 80 % cache reads, look for a breaker**; the skill puts *one breakpoint on the system block and one on each of the two latest user turns*; audit prompts at every model change; effort sweeps (Opus 5.5 scores 13.3 points lower at `low` than at `medium` on DRACO, a research benchmark) |
| A13 | [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) and [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) | ≥ 2026-11-09 | effort is the depth control; changing top-level effort invalidates the cache |
| A14 | [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | ≥ 2026-11-09 | changing `output_config.format` invalidates the conversation's prompt cache; schemas are cached for 24 h |
| A15 | [Citations](https://platform.claude.com/docs/en/build-with-claude/citations), [Search results](https://platform.claude.com/docs/en/build-with-claude/search-results) | ≥ 2026-11-09 | native citations (`cited_text` is free); not compatible with structured outputs |
| A16 | [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) | ≥ 2026-11-09 | 24 % fewer input tokens on agentic search (the figure A12 cites) |
| A17 | [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | ≥ 2026-11-09 (GA 2026-08-19) | progressive disclosure: ~100 tokens of metadata per skill, the body only when triggered |
| A18 | [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) | ≥ 2026-11-09 | deferring a toolset (`default_config.defer_loading`) |
| A19 | [Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests) | ≥ 2026-09-22 | volume over polish; automated and LLM grading with rubrics |
| A20 | [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory) (engineering) | **2026-11-06** | "Injected memories use up valuable tokens"; keep the injected top layer small and retrieve the rest |
| A21 | [Reducing cost and improving performance with Claude Platform](https://claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform) | **2026-09-08** (updated after 2026-09-22) | anti-patterns to remove: verification rituals, emphasis boosters, mandatory procedures, contradictory rules |
| A22 | [The anatomy of effective commerce agents](https://claude.com/blog/the-anatomy-of-effective-commerce-agents) | **2026-09-02** | breakpoint at the end of the global segment (system + tools); an instruction belongs in the system prompt only if it is relevant to about ⅓ of traffic, the rest goes in skills; UI components as typed tools rather than markup in the system prompt |
| A23 | [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview) | entries 2026-06-10 … 2026-11-09 | feature dates and model launches |

### Anthropic: models (5-month window)

| # | Source | Date |
|---|---|---|
| M1 | [Introducing Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5) | 2026-09-22 |
| M2 | [Introducing Claude Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5) | 2026-09-28 |
| M3 | [Introducing Claude Haiku 5.5](https://www.anthropic.com/news/claude-haiku-5-5) | 2026-10-07 |
| M4 | [Multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support) (Global-MMLU per language) | ≥ 2026-11-09 |

### OpenRouter (the agent reaches every model through it)

| # | Source | Date | Used for |
|---|---|---|---|
| O1 | [Prompt caching guide](https://openrouter.ai/docs/guides/best-practices/prompt-caching) | ≥ 2026-10-07 (lists the Haiku 5.5 minimum) | sticky routing with `session_id` (60 min); `cache_write_tokens` in `usage.prompt_tokens_details`; **GPT-5.6+ bills automatic cache writes at 1.25×**; `prompt_cache_options.mode: "explicit"` with no breakpoint turns caching off; **an Anthropic-style block `cache_control` becomes a `prompt_cache_breakpoint` on a supporting OpenAI model (30-min TTL)**; **the Responses API does not expose per-block `cache_control`**; minimum prefix of 512 tokens on the 5.5 family |
| O2 | [Reasoning tokens guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) | ≥ 2026-11-09 (names Fable 5.2) | preserve `reasoning_details` (or Responses reasoning items) across tool calls; mid-conversation effort changes that keep the cache (GPT-6, GPT-6.1, Opus 5, Fable) |
| O3 | OpenRouter `GET /api/v1/models` and `GET /api/v1/endpoints/zdr` | live, fetched 2026-11-10 | prices, cache read/write prices, ZDR endpoints, reasoning `mandatory` flags |

### Other

| # | Source | Date |
|---|---|---|
| X1 | [MCP specification 2026-07-28, changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | 2026-07-28. Minor change 3: servers SHOULD return `tools/list` in a deterministic order for prompt-cache hit rates (the BFF already does, `apps/workspace/bff/agent-api/catalog/index.ts:88`) |
| X2 | Artificial Analysis release pages: [Opus 5.5](https://artificialanalysis.ai/models/releases/claude-opus-5-5) (Sep 2026), [Sonnet 5.5](https://artificialanalysis.ai/models/releases/claude-sonnet-5-5) (Sep 2026), [Haiku 5.5](https://artificialanalysis.ai/models/releases/claude-haiku-5-5) (Oct 2026), [GPT-6.1 Terra](https://artificialanalysis.ai/models/releases/gpt-6-1-terra) (Oct 2026) | Pages carry no date; the data can only be from on or after each model's release month. Third party. Used only for the relative Intelligence Index per effort level |
| X3 | [ECB euro reference rate](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) | 2026-11-10: 1 EUR = 1.1214 USD |
| X4 | [EU MMLU announcement](https://translation.ec.europa.eu/news-and-events/news/towards-fair-multilingual-ai-eu-mmlu-new-eu-benchmark-llms-2026-07-22_en) (2026-07-22) and [arXiv 2608.17827](https://arxiv.org/abs/2608.17827) (2026-08-18) | Both checked for German results per model. Neither names model scores |

### Dropped, 16 items

- **Too old: 11 Anthropic engineering posts.** Effective context engineering (2025-09-29); Writing tools for agents (2025-09-11); Introducing advanced tool use (2025-11-24); Effective harnesses for long-running agents (2025-11-26); Code execution with MCP (2025-11-04); Equipping agents with Agent Skills (2025-10-16); Demystifying evals (2026-01-09); Quantifying infrastructure noise (2026-02-05); AI-resistant evaluations (2026-01-21); Harness design for long-running apps (2026-03-24); Scaling Managed Agents (2026-03-25).
- **Undated or anchored too early: 5 items.** OpenRouter provider-routing page (newest anchor 2025-11); OpenRouter usage-accounting page (no anchor; its field list is also on O1); OpenRouter GPT-6 migration guide (no reliable anchor); Anthropic compaction overview (no anchor; A9 covers it); Anthropic skill authoring best practices (no anchor).
- **Not used:** third-party GPT-6.1 Terra benchmark aggregators. They disagree with each other and none quotes OpenAI first-hand.

---

## Where a chat turn spends tokens (measured)

### Static prefix: the same bytes on every call of every turn (tools first, then system)

| Block | Tokens (o200k) | Where |
|---|---|---|
| **System prompt, rendered** | **10,685** (chars/4 gives 10,540) | `agents/piloti/prompts/chat_static.md` (4,905) plus `{{ answer_envelope_schema }}` (5,780) | <!-- brand-history -->
| ↳ CARDS contract | **4,812** (45 % of the system prompt) | `cards/envelope.py:114` `render_envelope_cards_contract` |
| ↳ ↳ shapes of `calculation` + `formula`, with worked examples | 2,506 | `cards/envelope.py:71` `ENVELOPE_SHAPE_TYPES` |
| ↳ KINDS, FIELDS, CITATIONS, the three examples | 1,818 (examples alone 673) | `chat_static.md:80-117` |
| ↳ envelope field list | 1,112 | `common/answer_envelope.py:1321` |
| ↳ formatting 922 · rules 689 · building_law 422 · voice 416 · role 228 · good_answer 160 · done 106 | | `chat_static.md` |
| **Tool schemas, chat agent, inside a project** | **20,798** | 28 runtime tools 19,086 + 6 file verbs 1,712 |
| ↳ `ifc_measure` | **5,974** (description 2,449) | `tools/bim/measure_description.py`, `measure_input.py` |
| ↳ `ifc_query` | 2,170 | |
| ↳ `dxf_measure` 1,092 · `knowledge_search` 1,037 · `project_lookup` 957 · `list_files` 872 · `canvas__mark` 670 · `ris_lookup_tool` 587 · `grep` 549 · … | | |
| ↳ outside a project, without the two IFC tools | 12,654 | `agents/piloti/turn_tools.py:25` | <!-- brand-history -->
| **Static prefix total** | **≈ 23.3k (no project) to 31.5k (project)** | |

Notes on the tool count:
- `web_search_tool` was measured with its placeholder description, because no `TAVILY_API_KEY` was set.
- `knowledge_search` and `list_files` were measured on their raw contract. The chat binding (`knowledge_layer/chat_binding.py`) rewrites both slightly.
- 54 of the parameters are `anyOf [X, null]` with `default: null`. Rendering them bare would save **888 tokens** (4.7 % of the tool payload).

### Per turn, dynamic

- **Turn context** (`prompts/piloti.j2`). It is rendered once per turn and sent as a human message right before the question (`prompt.py:425-452`). It is not stored. The bounds are in code: <!-- brand-history -->

  | Part | Bound | Where |
  |---|---|---|
  | inventory | 50 documents | `turn/inventory.py:44` |
  | office base knowledge | ≤ 17,000 chars ≈ 4.3k tokens | `turn/context_client.py:86` |
  | workspace | ≤ 6,500 chars | |
  | reference projects | ≤ 4,000 chars | |
  | project memory | ≤ 3,000 chars | `project_context.py:52` |
  | lessons | ≤ 2,400 chars | |
  | office instructions | ≤ 1,500 chars | |
  | already-read digest | ≤ 800 tokens | |
  | template prose | ≈ 1.7k tokens at most (1,660 tokens if every conditional renders) | |
  | chosen skill body and card shapes | ~400 tokens each when chosen | |

  Upper bound ≈ 12k tokens. Typical size is inferred as 3–8k: production's first call is 37k, minus 23–31k of static prefix.
- **History:** at most 40,000 tokens (`config_oib_openrouter.yml:1056`). The previous turn's tool results ride along, older ones are pruned to prose (`history.py:175-222`), and the window is re-trimmed on every turn (`history.py:89-106`).
- **Retrieval pasted per round:**

  | Tool | Bound | Where |
  |---|---|---|
  | `knowledge_search` | ≤ 16 hits × ≤ 2,500 chars, plus a 80–140-token header per hit, ≈ ≤ 11k tokens | `config:558`, `knowledge-layer/src/search/grounding_hits.py:21` |
  | `read_file` | ≈ ≤ 6k tokens | |
  | `read_passage` | ≤ 24,000 chars | `read_passage/ranges.py:36` |
  | web search | 8 × 1,000 chars | |

  Measured in production on 2026-11-04 (`docs/architecture/llm-providers.md`): **3.65 calls per turn; the first sends ~37k tokens; each later round adds ~8.3k; ~197k prompt tokens per turn; 70 % cached.** Output is 0.4–1.4 % of a turn's tokens and about 2 % of its cost (the comment at `config:139-145`), so **input caching is the cost lever, not effort**.
- **Post-answer calls, each one-shot:**
  - claim judge on the `follow_ups` model, evidence up to 60,000 chars ≈ 15k tokens (`common/claim_judge.py:59`)
  - follow-ups
  - memory reflection, digest ≤ 6,000 chars (`memory/reflection.py:71`)
  - the decision service, and the cross-encoder rerank on `qwen/qwen3-reranker-8b`
- **Deep research system prompts:**

  | Prompt | Tokens |
  |---|---|
  | orchestrator | 2,513 |
  | planner | 3,372 |
  | researcher | 2,584 |
  | writer | 4,197 |
  | router | 935 |
  | clarifier | 2,477 |
  | plan generation | 1,237 |

### How caching is wired today

`llm_factory.prepare_request` (`common/llm_factory.py:216`) sends `session_id` + `prompt_cache_key`. For `anthropic/*` models it also sends one top-level `cache_control: {type: ephemeral}`; that is OpenRouter's automatic caching (`common/prompt_caching.py:125`, `:238`). There is **no block-level breakpoint, by deliberate choice** (`prompt_caching.py:51`).

Reading that against A6 and O1:
- **Inside a turn, caching works.** The automatic breakpoint sits at the tail, and the next round's lookback finds it. The exception is a round that adds 20 blocks or more: with a width cap of 12 calls (`config:934`), a round of about 10 calls emits ~10 `tool_use` + ~10 `tool_result` blocks, which falls outside the lookback.
- **Across turns, almost nothing carries, and the cause is structural.** The previous turn wrote cache entries only at its tail positions, behind its own turn context. The next turn removes that context, prunes the turn before last and moves the trim window. No entry was ever written at the end of the system prompt, so the next turn's first call rewrites the whole 23–31k static prefix at 1.25×.

  The same holds on GPT-6.1: since GPT-5.6, OpenAI's automatic caching also writes at managed breakpoints and bills writes at 1.25× (O1). This matches the 2026-11-04 production finding: 30 % misses, "carries nothing between turns", a 72 % share where a carried prefix would give 86 %. A12's healthy bar is ≥ 80 %.
- **The Responses API blocks the obvious fix.** `research_llm` runs on it (`config:162`), and that API does not take per-block `cache_control` (O1). A block marker on the chat model therefore needs either the transport switched to Chat Completions or `prompt_cache_breakpoint` written into the Responses `input_text`.

---

## (b) Changes, ranked

Cost estimates use the measured turn profile above, OpenRouter list prices (O3) and ECB 2026-11-10. "eq" means input-token equivalents at the model's base input price. Every change below needs the answer suite run before and after, plus the closing checklist in the definition of done.

### 1. Put an explicit cache breakpoint at the end of the static system block

- **Where:**
  - `agents/piloti/prompt.py:447`: send `SystemMessage(content=[{"type":"text","text":prompt.system,"cache_control":{"type":"ephemeral"}}])`. <!-- brand-history -->
  - `common/prompt_caching.py:51` and `:120-135`: replace the "no per-block breakpoint" rule. Keep the top-level automatic marker; it takes a second slot of the four.
  - `configs/config_oib_openrouter.yml:162`: move `research_llm` to `api_type: chat_completion`, or emit `prompt_cache_breakpoint` on the Responses `input_text`.
  - `prompt_caching._system_text` already canonicalises list content, so the key stays stable.
- **Guidance it rests on:**
  - A6 (≥ 11-09): writes happen only at breakpoints; place one on the last block that is identical across requests.
  - A12 (≥ 11-09): one breakpoint on the system block.
  - A22 (09-02): a breakpoint at the end of the global segment.
  - O1 (≥ 10-07): block markers are translated to OpenAI's `prompt_cache_breakpoint` with a 30-min TTL; the Responses API does not expose per-block `cache_control`.
- **Saving:** the static prefix (23–31k tokens) on every turn's first call moves from a 1.25× write to a 0.05× read on terra, Opus 5.5 and Sonnet 5.5 (O3). That is ≈ 28–37k eq per turn. On gpt-6.1-terra this takes a routine answer from **≈ €0.083 to ≈ €0.057**, about 30 % of the main call's cost.
  - It also holds across conversations: every conversation of an org on one tool shard shares the prefix, so opening turns (65 % of turns, ADR-0154) benefit too.
- **Quality:** none expected; the model reads the same bytes.
- **Risk:** the move from Responses to Chat Completions changes the transport of every research call; the YAML comment asks for an answer-suite measurement first. All shards re-key once. Langchain's Responses converter may drop unknown block keys, so check the wire.
- **How to verify:**
  - Capture the request body at `bff_http`/OpenAI-client level and confirm the marker is in it.
  - On follow-up turns, the first call's `cached_tokens` should rise to roughly the static prefix. That is the carry the BFF already derives: `apps/workspace/bff/analytics/usage-export.ts:184`.
  - Run the suite: `task be:eval:answer-suite -- --out /tmp/suite/before` on the base branch and again with `--baseline` after.

### 2. Record `cache_write_tokens` in the ledger and in Langfuse

- **Where:** `common/cost_tracking.py:202-203` (the `CostEvent` fields), `:326-339` and `:743-760` (the usage parsers), `:266` (the Responses path), plus the BFF ledger columns. Today nothing reads the field: `grep cache_write` finds no hit in the agent or the BFF.
- **Guidance:** O1 lists `cache_write_tokens` in `usage.prompt_tokens_details`. A12: judge cache levers by net effect.
- **Saving:** none directly. Without this field nobody can tell whether a breakpoint pays, or whether the GPT-5.6+ 1.25× write tax lands on one-shot calls. It is the measurement that changes 1, 3, 4 and 7 depend on.
- **Risk:** a ledger migration.
- **How to verify:** a unit test on the parsers; a non-zero write on the first call of a fresh shard.

### 3. Make history edits batch-wise, and land the stable head from ADR-0154

- **Where:**
  - `agents/piloti/history.py:89-106`: `trim_messages(strategy="last")` re-trims every turn, which moves the start of history once a conversation passes 40k tokens. <!-- brand-history -->
  - `history.py:175-222`: `prune_tool_results` rewrites the turn before last on every turn.
  - The **unmerged** branch `origin/feat/chat-conversation-context-layout` (ADR-0154, `status: proposed`, 2026-11-04) moves the project and office blocks to one message after the system prompt. It measured a follow-up's new characters dropping from 41–44k to 14–17k.
- **Guidance:**
  - A8 (≥ 11-09): clearing invalidates the cache, so clear in large batches (`clear_at_least`).
  - A1 item 7 (≥ 11-09): keep history append-only.
  - A12: prune at task boundaries, in batches.
  - A20 (11-06): keep the injected memory layer small.
- **Saving:**
  - Trim in steps (when over 40k, cut to about 25k) and prune every K turns, so the prefix survives several turns.
  - Together with change 1, the 2026-11-04 production numbers point at ≈ +14 pp cache share on follow-up hours (72 % → 86 %).
  - Modelled after change 1, terra goes **€0.057 → ≈ €0.044 per answer**.
- **Quality:** a neutral-to-positive gain is expected: the stable head removes per-turn re-ordering. The branch's own reviews found that *storing* each turn's note costs more than it saves; take only the "stable head" variant.
- **Risk:** the window moving in steps lets a single request carry up to 15k more history tokens.
- **How to verify:** `test_cross_turn_prefix.py` exists on that branch only; the carry metric; the answer suite on a multi-turn set (`--set workspace` runs several turns).

### 4. Stop paying the 1.25× cache-write charge on one-shot calls

- **Where:** in `common/prompt_caching.prompt_cache_extra_body` (`:266`), send `prompt_cache_options: {"mode": "explicit"}` with no breakpoint, for one-shot roles on `openai/*` GPT-5.6+ models only. Those roles are: claim judge and follow-ups (`follow_ups_llm`), memory reflection (`card_llm`), `ris_planner_llm`, `rerank_llm` and requery, and `summary_llm`. Never send it on the research loop.
- **Guidance:** O1: "a prompt of 1024 tokens or more that is only sent once costs more with caching on than off".
- **Saving:** ≈ 0.25 × ~21k input on one-shot calls per answer: ≈ 5k eq, **€0.0047 per answer on terra**. Less if these roles move to luna or Haiku (see d).
- **Quality:** none.
- **Risk:** a role that does repeat a prefix (the RIS planner within a turn?) loses its hits. Decide per role from data once change 2 is in place.
- **How to verify:** `cache_write_tokens == 0` on those rows; the cost delta in the ledger.

### 5. Bind the IFC and DXF tools only when the project holds such a model

- **Where:** `agents/piloti/turn_tools.py:25-46`. Narrow `_PROJECT_MODEL_TOOLS` from "inside a project" to "a project with an `.ifc` (or `.dxf`) document", using the turn's inventory or a BFF flag. Whether a project has a model is a stable fact of that project, so an org still lands on a handful of cache shards. <!-- brand-history -->
- **Guidance:**
  - A5 (≥ 11-09): selection accuracy degrades past 30–50 tools; above 10k tokens of definitions, load on demand. The agent binds 34 tools at ~20.8k tokens.
  - A12: unused definitions cost money, not correctness.
  - ADR-0048 shows server-side `defer_loading` is billed in full through OpenRouter, so the client-side gate is the one that saves anything.
- **Saving:** 8,144 tokens (ifc) + 1,092 (dxf) per call in projects without a model. That is ~33k tokens per turn, which become 0.05× reads after change 1, plus fewer competing tools.
- **Quality:** expected positive (less selection noise); the BIM questions are unchanged in projects that have a model.
- **Risk:** a model upload still in flight; the inventory cap of 50 rows may hide one. Use a BFF flag.
- **How to verify:** a tool-scope unit test (`test_build_once.py` pattern); the answer suite plus `--set visual`.

### 6. Take the `calculation` and `formula` card shapes out of the static prompt

- **Where:** set `cards/envelope.py:71` to `ENVELOPE_SHAPE_TYPES = ()`. The decision layer already attaches the shapes of likely cards per turn (`agents/piloti/decisions.py` header; the `card_shapes_block` in `piloti.j2`). <!-- brand-history -->
- **Guidance:**
  - A22 (09-02): system-prompt instructions only for content relevant to about ⅓ of traffic, the rest on demand.
  - A1: few-shot examples where they mirror the case.
- **Saving:** 2,506 tokens per call (23 % of the system prompt). About 9k per turn, mostly cache reads, and less text competing with the rules.
- **Quality:** risk of more shape errors on those two cards, which the card-repair model already handles.
- **Risk:** low.
- **How to verify:** the answer suite, comparing how often cards are emitted, repaired or refused before and after.

### 7. Keep forced synthesis on the same tool binding

- **Where:** `agents/piloti/agent.py:1274-1310`. The truncation path calls `binding.llm` without tools and adds `response_format` (`envelope_call.py:68-89`). That changes the tools block, which invalidates the whole cached prefix, and on Claude a format change invalidates the conversation's cache as well (A14). So the longest call of a truncated turn is a full rewrite. The fix: keep the bound tools, use `tool_choice: "none"`, and rely on the fenced contract (rung 3) instead of switching formats. <!-- brand-history -->
- **Guidance:** A6 (a tool change invalidates everything; a `tool_choice` change invalidates only messages); A14.
- **Saving:** the whole context of truncated turns (60–150k tokens) moves from write to read. Size it first from how often `research_truncated` fires.
- **Quality:** neutral. Envelope validity rests on the parser rather than on strict JSON.
- **Risk:** some providers ignore `tool_choice: none`.
- **How to verify:** the share of truncated turns and their first-call cache share; the answer suite.

### 8. Audit the deep-research prompts against the current models

- **Where:** `agents/deep_researcher/prompts/researcher.j2`:
  - its "Research Protocol" (steps 1–8: "pause and assess", "start with broader searches", "stop when…");
  - "Be comprehensive: retain all relevant details", which contradicts its own "Depth … Drop restatement";
  - "You MUST match the language… e.g. If the query is in Chinese…";
  - `planner.j2` (5 MUST/NEVER), `orchestrator.j2` (2), `research_clarification.j2` (4).

  `chat_static.md` and `piloti.j2` were already audited (`docs/audit/prompt-value-audit-2026-10.md`); these were not. <!-- brand-history -->
- **Guidance:**
  - A12 (≥ 11-09): a mandatory step procedure, "be maximally thorough" and contradictions cost money and accuracy on current models.
  - A21 (09-08): mandatory procedures and emphasis boosters are anti-patterns; the prompt audit measured −9 % cost and +2 pp accuracy.
  - A1: soften aggressive language.
  - The repo's own rule: "say what the agent is for and give it tools".
- **Saving:** ~0.5–1k tokens per researcher system prompt, times researchers × calls, plus fewer tool rounds.
- **Quality:** expected positive (A12).
- **Risk:** report depth.
- **How to verify:** I found no `--set` for deep research in `scripts/turn_census/suite_cli.py`. Run a fixed set of commissioned reports through `nat run` and compare Langfuse cost and the writer's citation verification. That set is a gap to fill.

### 9. Pass reasoning back between tool rounds within a turn

- **Where:** the research loop keeps no `reasoning_details` or encrypted reasoning items; `grep` finds none in `packages/agent/src` (`common/callbacks.py:184` only logs it).
- **Guidance:** O2 (≥ 11-09): preserve reasoning blocks during tool use for continuity. A1 item 7.
- **Saving:** negative on tokens (the reasoning becomes input, mostly cached).
- **Quality:** expected positive on multi-round turns.
- **Risk:** this is the prefix check on Opus 5.5, Sonnet 5.5 and Haiku 5.5 (A11). It is safe only within a turn, because history is pruned across turns. Drop them at the turn boundary.
- **How to verify:** capture the round-2 request body; the answer suite, with the Claude arms from (d).

### 10. Remove `temperature` and `top_p` from every `llms` block

- **Where:** `config_oib_openrouter.yml:132-133`, `196-197`, `209-210`, … (every role). `rerank_llm` keeps `seed`.
- **Guidance:** the release notes (A23, 2026-10-21) say API version `2026-10-21` returns a 400 for sampling parameters on every model, and Opus 5.5, Sonnet 5.5 and Haiku 5.5 already reject non-defaults. OpenRouter drops them today only because the endpoint does not advertise them (the YAML comment).
- **Saving:** none. It removes a latent outage.
- **How to verify:** boot plus one suite run.

### 11. Render tool schemas bare

- **Where:** the same `with_bare_schema` treatment `tools/documents/tools.py` already applies to file tools, applied to every runtime tool. It drops `anyOf [X, null]` and `default: null`.
- **Saving:** 888 tokens per call. Low priority.

**Considered and not recommended now:**
- Anthropic `search_result` blocks and native citations (A15): they need the Messages API through OpenRouter's Anthropic endpoint, they are incompatible with the structured-output envelope rung, and the verifier the repo owns already does the job.
- Turn-scoped system messages for the turn context (A10): a Claude-only beta whose support through OpenRouter's Chat Completions is unverified. ADR-0154's stable head reaches the same goal provider-neutrally.
- Programmatic tool calling (A16): a server-side code container, and not ZDR-clean through OpenRouter.

---

## (c) What we do that current guidance calls counterproductive

1. **Caching only at the tail, and refusing block-level breakpoints** (`prompt_caching.py:51`). Writes happen only at breakpoints (A6). Anthropic's own audit places one on the system block (A12). The result is a measured 30 % miss rate against a healthy ≥ 80 % read share.
2. **Rewriting history on every turn**: a sliding trim plus a per-turn prune (`history.py:89-106`, `:175-222`). Guidance: append-only, and edits in a few large batches (A1 item 7, A8, A12).
3. **Running the main chat role on the Responses API** (`config:162`). On OpenRouter it makes block-level cache control impossible (O1), and the YAML says nothing needs it any more.
4. **Forced synthesis drops the tools and switches the output format**, which invalidates the entire cached prefix on the longest call (A6, A14).
5. **Mandatory step procedures, emphasis and contradictions in the deep-research prompts** (A12, A21, A1).
6. **Teaching card shapes for all traffic in the system prompt** (4.8k tokens, 45 % of it) when most turns emit no such card (A22).
7. **Dropping reasoning between tool rounds** (O2, A1).
8. **Sampling parameters on reasoning models** (A23, 2026-10-21).
9. **Automatic cache writes on one-shot GPT-5.6+ calls**: a 25 % surcharge for nothing (O1).

**Aligned, keep:**
- static system prompt and per-turn context split, with the context just before the question (A1, A12);
- date at day precision (A12);
- calm prompt with reasons and XML sections (A1);
- `session_id` + `prompt_cache_key` and no `provider.order` (O1);
- skills by progressive disclosure with one body inlined on demand (A17);
- deterministic `tools/list` (X1);
- medium effort as the research default (A2, A12);
- the workspace door as client-side tool search (`workspace__search/describe/call`, A5).

**Discrepancy between docs and code:** `docs/architecture/llm-providers.md` cites "the agent's `test_cross_turn_prefix.py`". That file exists only on the unmerged branch `origin/feat/chat-conversation-context-layout`, not on this branch. I did not modify the repo; it needs a fix in the change that lands or drops ADR-0154.

---

## (d) Model choice per role: quality and cost

**Live dev defaults (from the coordinator, `platform-model-defaults-get`):**

| Role (YAML key) | Model | Effort |
|---|---|---|
| `shallow_research` (`research_llm`) | openai/gpt-6.1-terra | medium |
| `deep_research` (`deep_orchestrator_llm`, `deep_planner_llm`, `deep_researcher_llm`) | openai/gpt-6.1-terra | medium |
| clarifier (`clarifier_llm`) | openai/gpt-6-luna | |
| router (`deep_router_llm`) | openai/gpt-6-luna | |
| memory reflection (`card_llm`) | openai/gpt-6-luna | |
| `ingest_vlm` (env `VLM_MODEL`) | openai/gpt-6.1-sol | |
| `follow_ups` (`follow_ups_llm`, which also serves the claim judge, `config:1088`) | not stated | none |

### Prices (OpenRouter, live 2026-11-10, O3), $ per million tokens

| Model | Input | Output | Cache read | Cache write (5 min) | Notes |
|---|---|---|---|---|---|
| openai/gpt-6.1-terra | 1.00 | 5.00 | 0.05 | 1.25 (automatic, billed) | ZDR via Azure; `azure/eu` +20 % |
| openai/gpt-6-luna | 0.10 | 0.50 | 0.01 | 0.125 | ZDR Azure |
| openai/gpt-6.1-sol | 2.00 | 10.00 | 0.10 | 2.50 | |
| anthropic/claude-opus-5.5 | 4.00 | 20.00 | 0.20 (0.05×) | 5.00 (1h: 2×) | reasoning **mandatory**; ZDR Bedrock/Vertex; EU +10 % |
| anthropic/claude-sonnet-5.5 | 2.00 | 10.00 | 0.10 (0.05×) | 2.50 | reasoning mandatory |
| anthropic/claude-haiku-5.5 | 0.10 | 0.50 | 0.01 | 0.125 | **×5 above 100k prompt tokens** (M3); reasoning can be off |
| google/gemini-4-argon | 2.00 | 10.00 | 0.10 | — | ZDR Vertex |
| mistralai/mistral-large-4-0 | 0.70 | 2.10 | 0.07 | no write charge listed | ZDR `mistral/eu` |

**Caching differs by vendor (O1, A6):**
- **Claude** caches only on request (the top-level automatic marker or block markers). TTL 5 min, or 1 h at 2× write. Minimum prefix 512 tokens on the 5.5 family.
- **GPT-6.x** caches automatically at OpenAI-managed breakpoints, bills writes at 1.25×, and takes explicit `prompt_cache_breakpoint` (30 min or 12 h TTL). Minimum 1,024 tokens.
- **Gemini** caches implicitly, uses only the last block marker, and has a 3–5 min TTL.

### Benchmarks (vendor-reported unless marked)

- **Knowledge work, GDPval-AA v2.1 Elo** (M1, M2, M3):

  | Model | Elo |
  |---|---|
  | Opus 5.5 | 1846 |
  | Sonnet 5.5 | 1844 |
  | Haiku 5.5 | 1620 |
  | GPT-6 Luna | 1437 |
  | GPT-6 Sol | 1487 |
  | GPT-6 Astra | 1542 |
- **Terminal-Bench 4.0:** Sonnet 5.5 70.6 %, Opus 5.5 66.4 %, Haiku 5.5 39.2 %, GPT-6 Luna 16.4 %.
- **Chartography without tools:** Opus 5.5 64.4 %, Sonnet 5.5 61.6 %, GPT-6 Sol 53.6 % (with a bug note), Haiku 5.5 46.4 %, Luna 29.1 %.
- **Artificial Analysis Intelligence Index** (X2, third party):

  | Model | Low | Medium | High |
  |---|---|---|---|
  | Opus 5.5 | 35 | 48 | 52 |
  | GPT-6.1 Terra | 29 | 38 | 42 |
  | Sonnet 5.5 | 26 | 31 | 42 |
  | Haiku 5.5 | 19 | 25 | 30 |

  Luna's overall index: 28. Haiku is the most verbose model on the index (298M output tokens, rank 33 of 33).
- **No first-hand OpenAI benchmark for GPT-6.1 Terra was found.** The aggregators disagree.
- **German:**
  - Anthropic Global-MMLU relative to English (M4): Opus 5.5 99.1 %, Sonnet 5.5 98.5 %, Haiku 5.5 97.4 %.
  - No dated German evidence for the GPT-6 family. EU MMLU and arXiv 2608.17827 publish no model-level German scores (X4).
  - No Austrian-legal benchmark exists in the window. **The repo's own German answer suite is the only decisive evidence.**

### Modelled cost per routine answer (main call only)

Assumptions: the measured 197k-token turn; 2.5k output tokens at medium (Haiku ×3 for verbosity); Claude input ×1.15 for its tokenizer; global ZDR endpoint; € at 1.1214.

| Scenario | terra | luna | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 | Mistral L4 |
|---|---|---|---|---|---|---|
| today (30 % miss) | **€0.083** | €0.009 | €0.012 | €0.192 | €0.367 | €0.050 |
| + change 1 (prefix carried) | **€0.057** | €0.007 | €0.010 | €0.133 | €0.248 | €0.037 |
| + changes 1 and 3 | **€0.044** | €0.006 | €0.008 | €0.101 | €0.184 | €0.029 |

Post-answer calls (claim judge, follow-ups, reflection; ~21k in, 1.2k out):

| Model | Cost per answer |
|---|---|
| terra, today (automatic writes) | €0.029 |
| terra, change 4 (cache writes off) | €0.024 |
| luna or Haiku 5.5 | €0.0024–0.0029 |

**So today's routine answer on terra is ≈ €0.11, about 2× the €0.05 bar.** Changes 1, 3 and 4, plus the cheap stage models, bring it to ≈ €0.047. The EU endpoint adds 20 % on terra. Not counted: the decision service, reranker search units, ingest.

### Recommendation per role, with the experiment that would confirm it

The suite has no BFF, so it runs the **YAML floor**: `${DEFAULT_MODEL:-openai/gpt-6-luna}`. **The baseline must override the model to terra explicitly, or it measures luna.** The flag is `--override KEY VALUE` after `--` (`suite_cli.py:34`, keys in `nat run` dot notation). The OpenRouter ids are `anthropic/claude-opus-5.5`, `anthropic/claude-sonnet-5.5` and `anthropic/claude-haiku-5.5`; the dashed Anthropic ids do not route there.

| Role | Recommend | Effort | Est. € per answer | Why |
|---|---|---|---|---|
| `shallow_research` | **keep gpt-6.1-terra**, after changes 1, 3, 4 | medium | ≈ 0.044 (+ ~0.003 stages) | The only frontier-tier option near the bar. On the AA index Opus 5.5 at medium (48) beats it, at 4–7× the cost. Sonnet 5.5 at medium (31) is dominated: a lower index at 2× the price. Haiku 5.5 is the challenger at ~€0.01, but its index at medium is 25 against Terra's 38, so let German legal accuracy decide. |
| `deep_research` | keep terra | medium | per report, not per answer | Anthropic's research data: Opus 5.5 drops 13.3 points at `low` (A12), so do not lower effort. Opus 5.5 as orchestrator/writer is the quality arm. |
| clarifier | **Haiku 5.5** challenger against luna | low | ~0.001 | Same price as luna; vendor Elo 1620 against 1437. Keep prompts under 100k tokens: the ×5 price step. |
| `deep_research_router` | keep luna; Haiku 5.5 arm | low | <0.001 | Small JSON routing; little to gain. |
| memory reflection (`card_llm`) | **Haiku 5.5** challenger | low | ~0.0005 | Same price, stronger knowledge-work numbers. |
| `follow_ups` + claim judge | luna or Haiku 5.5, `none` | none (the group requires reasoning off) | ~0.002 | Move off terra if it runs there. The claim judge deserves its own group with `low`; check it on `tests/fixtures/answer_check/stored_answers_2026-10.json`. |
| `ingest_vlm` | **Sonnet 5.5** challenger against gpt-6.1-sol | low | same price | Chartography without tools 61.6 % against Sol's 53.6 %. Opus 5.5 reads dense charts better even at low effort (A2), at 2× the price. |

**Experiments.** Run each arm with `--out`. Pass `--baseline <terra>/results.json` so `compare.md` reports accuracy, tokens and cost per answer.

```bash
# baseline = production
task be:eval:answer-suite -- --out /tmp/suite/terra \
  --override llms.research_llm.model_name openai/gpt-6.1-terra \
  --override llms.research_llm.reasoning_effort medium \
  --override llms.follow_ups_llm.model_name openai/gpt-6.1-terra \
  --override llms.card_llm.model_name openai/gpt-6-luna

# challengers for the main role (one variable at a time; api_type kept as configured)
task be:eval:answer-suite -- --out /tmp/suite/haiku --baseline /tmp/suite/terra/results.json \
  --override llms.research_llm.model_name anthropic/claude-haiku-5.5 \
  --override llms.research_llm.reasoning_effort medium
task be:eval:answer-suite -- --out /tmp/suite/opus --baseline /tmp/suite/terra/results.json \
  --override llms.research_llm.model_name anthropic/claude-opus-5.5 \
  --override llms.research_llm.reasoning_effort medium

# transport arm for change 1, measured on its own
task be:eval:answer-suite -- --out /tmp/suite/terra-cc --baseline /tmp/suite/terra/results.json \
  --override llms.research_llm.model_name openai/gpt-6.1-terra \
  --override llms.research_llm.api_type chat_completion

# post-answer stages
task be:eval:answer-suite -- --out /tmp/suite/stages --baseline /tmp/suite/terra/results.json \
  --override llms.research_llm.model_name openai/gpt-6.1-terra \
  --override llms.follow_ups_llm.model_name anthropic/claude-haiku-5.5 \
  --override llms.card_llm.model_name anthropic/claude-haiku-5.5 \
  --override llms.card_llm.reasoning_effort low

# clarifier / router (only exercised on hand-offs)
#   --override llms.clarifier_llm.model_name anthropic/claude-haiku-5.5
#   --override llms.deep_router_llm.model_name anthropic/claude-haiku-5.5
# deep research arm (no suite set covers it; keys for nat run)
#   llms.deep_orchestrator_llm.model_name, llms.deep_planner_llm.model_name, llms.deep_researcher_llm.model_name

# vision is env, not a config key (knowledge-layer/src/ingest/adapter.py:106)
VLM_MODEL=anthropic/claude-sonnet-5.5 task be:eval:answer-suite -- --set visual --out /tmp/suite/vlm-sonnet
```

These were not run: the suite's key has no credit. Every figure in (d) is modelled from the 2026-11-04 production profile, not measured on these models. The suite runs are what turn them into evidence.

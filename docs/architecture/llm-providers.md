# LLM providers — the OpenAI-compatible, agnostic model

> Piloti is not tied to any LLM vendor. Any OpenAI-compatible endpoint is a valid
> provider, selected entirely by configuration. See also
> [ADR-0010](../adr/0010-llm-agnostic-openai-compatible.md).

## The principle

No vendor is hard-coded in application logic. The active LLM and embedding
provider is chosen in the **workflow config** (`configs/*.yml`) by setting an
OpenAI-compatible `base_url`, a `model_name`, and an API-key env var. Because the
agent runtime's LLM/embedder providers (NeMo Agent Toolkit) speak the OpenAI wire format, this
covers a wide range of backends with **no code change**:

- Managed aggregators (OpenRouter)
- Self-hosted inference (vLLM, Ollama, TGI)
- Cloud vendors' OpenAI-compatible endpoints (Azure OpenAI)
- NVIDIA NIM

## Choosing the active config

`CONFIG_FILE` (env, set in compose) selects the active workflow config. The shipped
**reference config** is `configs/config_oib_openrouter.yml` (OpenAI GPT-5.6 Luna
+ embeddings via OpenRouter). The `model_name` values there are the boot floor
only — the model a served request runs on is an admin decision resolved at
runtime (see `org-model-configuration.md`), except for `summary_llm` and
`rerank_llm`, which have no agent group and always use the config file.

```yaml
# configs/config_oib_openrouter.yml (excerpt) — an OpenAI-compatible LLM
llms:
  research_llm:
    _type: openai
    base_url: "https://openrouter.ai/api/v1"
    model_name: openai/gpt-6-luna
    api_key: ${OPENROUTER_API_KEY}
    # max_tokens / max_retries / reasoning_effort tuned per role
```

The config defines several LLM "roles" (the main super-model, the clarifier,
the deep-research models, summarization) so different steps can use
different models/parameters. Point them all at your endpoint to switch providers.

## To use a different provider

1. Copy the reference config (or edit it).
2. Set each `llms.*` block's `base_url`, `model_name`, and `api_key` env to your
   endpoint.
3. Set the embedder similarly (embeddings must also be OpenAI-compatible).
4. Set `CONFIG_FILE` to your config and provide the key(s) in `deploy/.env`.

## Which model each role uses

Every agent names its models by `llms:` key, never by model id, so pointing a
role at another model is a config edit and never a Python one. Each key must
exist under `llms:`.

Deep research (`deep_research_agent`, `packages/agent/src/agent/agents/deep_researcher/register.py`)
binds one model per role:

| Config field | `LLMRole` | Agent group an admin re-points |
|---|---|---|
| `orchestrator_llm` (required) | `ORCHESTRATOR`, and the default for every role left unset | `deep_research` |
| `source_router_llm` | `ROUTER` | `deep_research_router` |
| `researcher_llm` | `RESEARCHER` | `deep_research` |
| `planner_llm` | `PLANNER` | `deep_research` |
| `writer_llm` | `REPORT_WRITER` | `deep_research` |

There is no generic `llm` field on deep research, so changing
`orchestrator_llm` moves every role you did not set. Piloti reads `llm:`
(`research_llm`), and `claim_judge_llm` (`follow_ups_llm`) for the answer check
that grades each answer against everything its turn registered (ADR-0139),
resolved per turn on the `follow_ups` agent group and bound to temperature 0.
The clarify step is configured by the `clarifier:` block on
`chat_deepresearcher_agent` (`ClarifierSettings` in
`packages/agent/src/agent/agents/piloti/clarify.py`): `llm` asks the questions and
`planner_llm` writes the plan, falling back to `llm` when unset.

## Runtime per-org model overrides (ADR-0014)

The YAML remains the *default* layer. On top of it, org admins can re-point
each **agent group** (clarifier, research, deep research,
deep-research router, memory reflection) at a different OpenRouter model at
runtime — per tenant, versioned, validated against the OpenRouter catalog,
no restart. The BFF forwards the active configuration as the
`x-grid-model-overrides` header on the WS upgrade; the backend applies it
request-scoped (only the model id changes — `base_url`, keys, `max_tokens`,
`reasoning_effort` still come from the YAML). Absent/invalid overrides fall
back to the YAML defaults. See
[`org-model-configuration.md`](org-model-configuration.md).

Every generation's cost is metered into the `llm_usage_events` ledger and
bounded by per-org/member/project budgets — see
[`usage-budgets.md`](usage-budgets.md) (ADR-0015).

## Where a call is processed (ADR-0167)

Every model call is routed and recorded by `common/residency.py`, called from both seams: the httpx
transport in `common/openrouter.py` (embeddings, vision, reranking, summaries, titles, decisions, the
distiller, dictation) and the chat-request contract in `common/llm_factory.py` (every chat model).
The data-flow register places each host (`endpoints` in `configs/subprocessors/openrouter.yaml`:
`eu.openrouter.ai` in `EU`, `openrouter.ai` in `US`), and every generation carries
`processing_location`, `subprocessor` and `processing_location_compliant` as observation metadata.

With `RESIDENCY_CELL` unset (the default) nothing is rewritten or refused. With a cell
(`configs/residency/cells.yaml`) the transport rewrites `openrouter.ai` to `eu.openrouter.ai`, refuses
any host outside the zone before sending, and zero data retention cannot be switched off. The chat
models cannot be rewritten per call (their client is built at boot), so a cell sets
`OPENROUTER_BASE_URL=https://eu.openrouter.ai/api/v1`, which every `llms` entry of
`configs/config_oib_openrouter.yml` reads; the boot check refuses a cell without it.

## Caveats

- Prompts are tuned against the reference model; very different models may need
  prompt adjustments.
- A blank or `${VAR}`-literal key (a common `env_file` interpolation mistake) is
  treated as **unset** by the config-validation guard, failing fast rather than
  sending unauthenticated requests.
- The legacy Kimi config is **unmaintained/broken** — do
  not use it as a starting point; base new configs on the OpenRouter reference.
- **Prompt caching** is set per call in `common/prompt_caching.py`, through
  `llm_factory.prepare_request`, on every OpenRouter call of an agent: a
  `session_id` + `prompt_cache_key` so a turn's calls land on the endpoint that
  holds the cache, and for `anthropic/*` models a top-level `cache_control`,
  because Claude caches nothing unless asked. Until 2026-10-27 that field was
  missing and 60 M Claude prompt tokens in 30 days were all billed at full
  price; the OpenAI models, which cache on their own, were at 51 %. Read the
  share per model from `llm_usage_hourly` (`cached_tokens / prompt_tokens`);
  the „Costs and budgets (prod)" alert fires when Claude's drops to near zero.
- **Where the chat cache misses (measured 2026-11-04, production, 10 days of
  `openai/gpt-6.1-terra`).** A chat turn makes 3.65 calls on average; the first
  sends about 37 k prompt tokens and each later round adds about 8.3 k. If the
  first call of every turn is cold and every later round re-reads all but its
  new tokens, the miss share is (37 k + 2.65 × 8.3 k) / 197 k ≈ 30 %, which
  is the 70 % cache share the ledger shows. That share fits a conversation
  whose cache carries little or nothing across turns, but it does not say which
  calls hit. Two more signals point the same way: hours with five or more turns
  by one person reached a 72 % share where a carried prefix would give about
  86 %, though 87 of 101 follow-up turns came within 30 minutes of the previous
  one (median 129 s); and driven through the code that builds the requests, a
  follow-up repeats 31 % of what the previous turn last sent
  (the agent's `test_cross_turn_prefix.py`), because the turn context
  is not stored and the history window moves every turn. OpenAI bills a cache
  write at 1.25x input from GPT-5.6 on, so a cold first call costs more than an
  uncached one used to. The per-answer carry is measured from the first agent
  call of each answer (`chat_cross_turn_cache_carry` in PostHog).
- **What zero data retention leaves open on price (2026-11-04,
  `/api/v1/endpoints/zdr`).** Only Azure serves `openai/gpt-6.1-terra` and
  `openai/gpt-6-luna` with zero data retention; `azure/eu` lists 20 % above
  the global `azure` endpoint (terra $1.20 vs $1.00 per M input), and the EU
  Claude endpoints 10 % above global. `openai/flex` (half price) and OpenAI's
  own endpoint are not ZDR, so `service_tier: "flex"` cannot serve a ZDR call.
  OpenRouter's Batch API (2026-09-22, about half price) keeps inputs and
  results for 30 days, which ZDR rules out too. The cheaper routes are therefore
  data-residency decisions, not request flags.
- **LLM request timeouts — fixed 2026-07-16 (`590ba1a`).** Every `llms.*`
  block in `configs/config_oib_openrouter.yml` now sets `request_timeout`
  (60–180 s depending on role) and `max_retries: 2`, so an unresponsive
  upstream call can no longer hang a run indefinitely at the HTTP layer.
  This is in addition to, not a replacement for, card generation's 30 s
  app-level timeout. `DeepResearcherAgent` additionally gained a wall-clock
  `max_run_seconds` budget (config key, default 2400 s; `0` disables) around
  the whole run via `asyncio.wait_for` — `recursion_limit` still bounds graph
  *steps*, not time, but the run as a whole is now bounded either way.
- **Retry stacking — tamed 2026-07-16 (`590ba1a`, `0b5d29d`).** Per-role
  client-level `max_retries` in the YAML dropped from 5–10 to a uniform `2`
  across every role (`configs/config_oib_openrouter.yml`). The deep-research
  middleware retry predicates were also narrowed: `ModelRetryMiddleware`
  (`agents/deep_researcher/factory.py`) now retries only rate limits,
  timeouts, transport errors, and 5xx (`_is_transient_model_error`) instead
  of any exception, and `SelectiveToolRetryMiddleware`
  (`agents/deep_researcher/custom_middleware.py`) retries on anything except
  `ValueError` — the model's own "invalid input" signal, which a retry can
  never fix. Retries across the three layers (client, model middleware, tool
  middleware) are still independent and uncoordinated (no shared budget or
  deadline), but the worst case per logical turn is now on the order of a
  handful of attempts, not ~33. See
  [`docs/audit/scaling-review-2026-07.md`](../audit/scaling-review-2026-07.md) §6.3 for the
  cross-run multiplication this still doesn't address (bounded fan-out, not
  a shared retry budget).
- **`api_type: responses` is a per-ROLE opt-in, not a fleet default.**
  `LLMBaseConfig.api_type` (`chat_completion` | `responses`) is already
  understood by the agent runtime: `nat.plugins.langchain.llm.openai_langchain` builds
  `ChatOpenAI(use_responses_api=True, use_previous_response_id=True)` when it
  is `responses`. The one app-side adjustment is
  `llm_factory.disable_previous_response_id`, which turns the response handle
  off for OpenRouter targets: its Responses API is stateless and rejects a
  non-null `previous_response_id` with a 400. Today only `research_llm` sets
  it. It was switched on for OpenRouter's deferred tool loading (ADR-0048),
  which was off from 2026-09-25 and whose code was removed on 2026-10-27; a
  standards-based tool search replaces it in its own change. The line stays
  until the answer suite has measured Chat Completions for this role, because
  the transport of every research call is not a change to make as a side
  effect. Every other role stays on the default.
- **Deferral did not save tokens on any model measured (ADR-0048,
  2026-09-23).** Every model probed echoed `defer_loading` and billed the
  deferred schemas in full; capability tracked neither vendor nor quality, and
  OpenRouter's `supported_parameters` has no token for it. The measurements
  are in the ADR; a new tool search starts from them rather than re-deriving
  them. Since ADR-0052 Piloti binds its full tool set on every turn, greetings
  included; scope (`turn_tools.tools_in_scope`) is what keeps the BIM schemas
  off a turn without a project.
- `reasoning_effort` is a **native** `ChatOpenAI` field
  (`langchain_openai`'s `BaseChatOpenAI.reasoning_effort`), not something
  routed through `extra_body`: the runtime's `OpenAIModelConfig` allows extra YAML
  keys (`model_config = ConfigDict(..., extra="allow")`) and the LangChain
  client picks the field up directly, translating it to the provider's
  native `reasoning` payload shape where needed (e.g. OpenRouter). No app
  code shuttles it manually — worth knowing so it isn't mistaken for one of
  the `extra_body`-routed OpenRouter-specific knobs (see
  `agent.common.llm_factory`).
- **Reasoning-effort contract (2026-07-16, `590ba1a`).** Every shipped
  config's `reasoning_effort` value is now drawn from OpenRouter's *standard*
  vocabulary — `none`/`minimal`/`low`/`medium`/`high`/`xhigh` (the reference config
  currently uses `none` for the cheap/fast roles and `medium` elsewhere) —
  and sent through verbatim, with no per-provider translation layer in app
  code. This is intentional and safe, not a gap: OpenRouter maps that
  standard value to the nearest level the request's *actual* model supports,
  server-side, per model, so the same YAML value is correctly interpreted
  regardless of which model ultimately serves the request (including an
  org's runtime model override — see `org-model-configuration.md`). The
  corollary is a hard constraint on config authoring: **provider-native tiers
  that aren't OpenRouter-standard (e.g. DeepSeek's own `max` tier) are not
  legal values and must never appear in a config** — OpenRouter has no
  mapping for them, so behavior at the provider is undefined.

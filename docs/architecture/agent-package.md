# The agent package: its seams and invariants

The explanation behind the short rules in
[`packages/agent/src/agent/AGENTS.md`](../../packages/agent/src/agent/AGENTS.md):
what each seam owns, which test holds it, and what breaks without it. Paths are
relative to `packages/agent/src/agent/` unless they say otherwise.

## The seams, one per change

| When you | You must | What fails you |
|---|---|---|
| Import from `agent_host` | Own the type or state in `agent` and let `agent_host` write it (`auth/request_identity.py`, `auth/errors.py`), or take the capability as a parameter its API-tier caller passes (`oib_sync`'s `enqueue`) | The `agent-api-seam` import-linter contract (root `pyproject.toml`, run by `task be:lint`) |
| Add a source kind | Add it to `SOURCE_KINDS` in `common/source_kinds.py` and commit what the `vocabularies` hook regenerates (`.venv/bin/python scripts/generate_vocabularies.py` by hand); then give it a tint (`KIND_TO_SIGNAL`) in `apps/workspace/bff/source-kinds.ts` | The `vocabularies` pre-commit hook and `tests/test_vocabularies_generated.py` for the tuple; `task workspace:types` for the missing tint |
| Emit a card | On chat, put it in the answer envelope's `cards` field (`cards/envelope.py`); the chat agent no longer binds `emit_card`. Deep research still pushes through the `emit_card` tool, and a system card is pushed by the tool that did the work. Every path lands in the session `CardRegistry`; address a card from prose as `[[card:N]]` | The frontend resolves N positionally against the same ordered array. A card that bypasses the `CardRegistry` is unaddressable |
| Add, move or rename a pydantic type carried in `ConversationState` | List it in `allowed_msgpack_modules` in `_build_checkpointer_serde` (`common/__init__.py`). A stored checkpoint names the type by module path, so a move needs the old path to keep resolving | Nothing local. A type the serde does not allow comes back from a checkpoint as a plain dict |
| Make the answer follow the person's language | Decide from the newest user message (`common/question_language.py`), never from a sentence in the system prompt: a large German turn context outweighs that sentence | Review. The trace carries `question_language` and `answer_language_instructed` |
| Add or rename a value of `JobState` or `FileStatus` (`knowledge/schema.py`) | Give it a branch in every workspace reader in the same change: the zod enums in `apps/workspace/ui/adapters/api/documents-schemas.ts`, `mapBackendStatus` and `isEndedJobStatus` in `ui/features/documents/utils.ts`, and `resolveJobOutcome` / `resolveFromCollection` in `bff/documents/reconcile-status/ingest-resolution.ts`, which compare strings and read an unknown job status as still running | `tests/knowledge_layer_tests/test_ingest_state_parity.py` for the enums and the map; nothing for the BFF's readers, where the document row stays `pending` for good |
| Add per-turn state | A `ContextVar` registry created/reset per turn, the way `cards/registry.py` and `citations/session.py` do | Module-level state leaks across turns and across tenants. Process-lifetime state is allowed only when it holds no tenant or turn data: a bounded cache keyed by model id or content (the query-embedding LRU and its in-flight dedupe in `packages/knowledge-layer/src/search/query_embeddings.py`, `common/llm_factory._REASONING_MANDATORY`), a build-time handle (`knowledge/factory._SEARCH_RETRIEVER`), or references that keep running work alive (`register._WARMING` in the chat agent's package under `agents/`) |
| Add a line to the grounding block a tool returns | Put the field on `GroundingHit` and the line in `render_grounding_block` (`common/grounding_block.py`), then read it back in `_entry_from_hit` (`citations/extraction.py`). Both producers build records; neither writes grammar text (ADR-0061). A field the model must not read or copy (a record id, a public address: `work_id`, `edition_id`, `public_url`, `revision`) is a record field with NO line; add it to `SourceEntry`, to `_registry_from_cached_entries` (`citations/session.py`) and to `RECORD_ONLY_FIELDS` in the contract test | The byte-identity fixtures in `packages/agent/tests/common/test_grounding_block.py`, and then the contract test, where the two readers stop agreeing |
| Add a tool that answers in the grounding grammar (`render_grounding_block`) | Register its name with the text parser too: `register_source_parser(lambda name: "<tool>" in name, parse_knowledge_layer)` in `citations/text_parsers.py` | Nothing on a live turn, which reads the records. A REPLAYED turn reads the text, falls through to the URL extractor, and its citations vanish. `project_lookup` was written without it, and only a test that replays its result caught it |
| Add a tool that returns web pages, or change how the web search prints a hit | State each hit as a record (`<Document href>` + `<title>`, `tavily_web_search.register._record`), make the page's own text inert (`_inert`), and register the tool's name with `citations/web_results.parse_web_results`: only a record names a source. What is a copy of a work the turn holds is `common/web_sources.py`'s to say, from the source records and the works' designations; no host, law or file-name pattern goes into code | `packages/agent/tests/citations/test_web_results.py` and `tavily-web-search/tests` (a link in a page's body, a forged record); `test_web_sources.py::test_no_host_and_no_law_of_a_country_is_written_into_the_screen_s_code` |
| Give a cited passage a role, an edition or a date | State the knowledge record on the hit (`GroundingHit.work_id` / `edition_id`); `citations/roles.py` resolves everything by that id against the turn's `knowledgeContext.uses`. A live source's producer finds the work with `knowledge_context.use_for_source_ref` and the identifier its source record reads (`identifiers`). Never match a URL, a host or a file-name pattern, and name no country ([`docs/design/citations.md`](../design/citations.md)) | `tests/citations/test_roles.py` (`test_an_address_decides_no_role`), `tests/citations/test_citation_line_fields.py` |
| Build a prompt block from rows | Bound it, and say in the text the model reads that it is bounded | Cost grows with project size on every turn, and the agent answers "which files do I have" confidently and wrongly. See `render_inventory_block` |
| Change a card model (`cards/models.py`, the union, or a card's own module beside it, e.g. `cards/look_card.py`) | Commit what the `card-schemas` hook regenerates. By hand: `.venv/bin/python scripts/generate_card_schema.py`, then `npm run generate:cards` in `apps/workspace` | The `card-schemas` pre-commit hook, and `task workspace:cards:check` in CI. Without them the frontend validates the old schema, and it type-checks |
| Change a builtin skill's `SKILL.md` | Re-run the generator: `node apps/workspace/scripts/sync-platform-skills.mjs` | `sync-platform-skills` pre-commit hook. A stale generated module type-checks perfectly, which is why it has broken the build from behind three times |
| Call the BFF (`/api/internal/*`, `/api/mcp`) | Go through `common/bff_http.py`: `send`, `get_json`, `post_json` or `request_json`. It owns the base URL (`FRONTEND_INTERNAL_URL`, then `FRONTEND_URL`, then `http://frontend:3000`), the service token (no token, nothing is sent), the opener (no redirects, no proxies, HTTP only) and `BffError`; subclass that for your domain's error. Tests fake the transport at `bff_http._opener` and nowhere else | `packages/agent/tests/common/test_bff_http_ratchet.py`: a redirect guard, a `FRONTEND_INTERNAL_URL` read or the token header anywhere else fails it, and its allowlist of the httpx callers left to port may only shrink |
| Render, trace or log a retrieved passage | Carry the hit's licence (`GroundingHit.licence`, from `licensed_text.licence_from_metadata`) and let `render_grounding_block` render it; a direct generation's payload goes through `observability/direct_trace._clip`. Never print a licensed document's own text outside the renderer (`grep`'s line index skips it) | `tests/common/test_licensed_seam.py` for the chat seam and direct traces, `test_licensed_recall.py` for a later turn's reference read again from its document (`common/licensed_recall.py`), `knowledge-layer/tests/test_licensed_hits.py` for the producers. A licensed body in a `ToolMessage` is in the checkpoint, the next turn's history and Langfuse (ADR-0164) |
| Make a model call anywhere (a new route, an ingest step, a script) | Go through the seam in `common/openrouter.py`: `pin_chat_model`, `ResolvedCredential.request_body` (`common/credential_resolution.py`), `PLATFORM_FIXED.apply`, `openai_client`, `pinned_http_client`, or `limited_async_http_client` for a body that already carries the policy. A model no organization chooses is always pinned; one it chooses follows `data_policy_for`. Name a platform-fixed model only if it has a zero-data-retention endpoint. A new model host gets an `endpoints` entry in its register row, or a residency cell refuses it as unplaced (ADR-0167) | `packages/agent/tests/common/test_openrouter_call_sites.py` and `test_provider_limiter_call_sites.py`. Zero data retention is on by default (ADR-0074), and a call that skips the seam sends a tenant's text to a provider that may keep it; a raw `httpx` client to OpenRouter also skips the provider limiter (ADR-0081) |

## Rules that need more than a row

**A measurement is not a source.** The four retrieved kinds (`building_law`,
`office`, `project`, `web`) are passages a citation resolves to and can be read
back. `measurement` is reproducible instead, carries GlobalIds and a tolerance, and
travels its own channel (`tools/bim/measurement_sources.py`). Putting one in
the `SourceRegistry` would let a basement measurement ground an uncited legal
verdict, the exact laundering path the chat agent's grounding guard exists to
close. The header of `common/source_kinds.py` is the full argument.

**A model override arrives per agent group, through the context headers.**
Resolve it in `common/model_overrides.py`, which is the one place that knows the
group.

## The per-turn harness: `turn/`

Everything that happens exactly once per chat turn and is **not** the answering
agent: parsing what the request says about the turn, loading its context and
document inventory, binding the per-turn registries, admitting it against
capacity and budget, lifting the finished state onto the wire, streaming it.
The chat workflow's `conversation_register.py` composes these units in that order.

**What belongs there.** Ask how often it runs. Once per request, whatever the
graph decides (a header parse, an inventory load, a registry bind, a refusal), is
a unit in `turn/`. Once per step of the conversation, deciding what the turn is
(an escalation edge, a clarify hop, an answer), is a graph node in
the chat agent's package under `agents/`. Each unit is a plain function with an explicit signature, so it
can be tested without standing up the runtime's workflow. The harness used to be
one closure, and a field could be written, declared by the frontend and reach
nobody without a single test noticing.

**The dependency runs one way.** `agent_host` hosts this workflow and imports it;
nothing under `agent` imports `agent_host` (the `agent-api-seam` import-linter
contract in the root `pyproject.toml`, run by `task be:lint`). What the agent
needs from a request lives in the agent tier and the API tier writes it there:
the caller identity (`auth/request_identity.py`, bound by the middleware), the
auth error (`auth/errors.py`, subclassed by the token errors). An API-tier
capability the agent drives is handed in by its API-tier caller (`oib_sync`'s
`enqueue`). `turn/` also imports no agent state at runtime: `response.py` and
`dispatch.py` type against it under `TYPE_CHECKING` only.

**A wire field or a stage fact** goes on `TurnResult` (`common/wire_v2.py`), is
lifted in `response.build_result`, and has a test that reads it back. Nothing
else fails: a field nobody lifts is set, valid, and invisible.

**Setup I/O** joins the existing `asyncio.gather` in
`conversation_register.py` (and `turn/context.py`) and fails open
on its own; in series it lands on the time-to-first-byte path.

### The live answer (ADR-0066)

`turn/answer_stream.py` streams the answering call's prose while the model writes
it, as wire bodies through the graph's own writer (`turn_status.emit`, chat wire
v2 §b). The docs of record are [`chat-wire-v2.md`](../design/chat-wire-v2.md) and
[`streaming-chat-answer.md`](../design/streaming-chat-answer.md).

- The token callback is added to the call's inherited manager
  (`streaming_call`), never passed as the call's own `callbacks`. Those replace
  the inherited ones, and the runtime's profiler, which bills the call, rides on
  them.
- Live bodies are provisional. `RUN_FINISHED` is authoritative, replaces the
  text, and is what the socket persists.
- A streamed call that turns out to ask for tools was a round, not the answer. It
  writes `answer_retracted`, `LiveProse.streamed` resets, and a later call of the
  turn may stream again.
- Deltas are coalesced at the producer: at most one `TEXT_MESSAGE_CONTENT` per
  `RELAY_WINDOW_S`, and whatever is held goes out before any other body.
- Work in a token callback heavier than parsing goes off the loop
  (`asyncio.to_thread`, as `_settle_prose` does). The stream awaits the callback,
  so body order holds.
- The verifier and the gates stay on the agent side, behind the `Live` protocol
  (`answer_pipeline.LiveAnswer`). `turn/` does not import them.
- Every generator in the turn is closed with `contextlib.aclosing`. `async for`
  never closes what it iterates, so a consumer that walks away would leave the
  graph suspended mid-run past the ledger flush.
- Everything fails open. Nothing bound, an LLM that cannot stream, or a callback
  that raises, and the turn is the buffered turn it was.

---
status: accepted
date: 2026-11-10
decision-makers: Grid engineering, product owner
consulted: two independent architecture reviews (framework adoption; necessity and correctness), 2026-11-04; the token-budget report (docs/design/international/research/token-budget-2026-11.md), 2026-11-10
informed: everyone working in this repo
---

# What the project and the office set goes at the head of a chat request

Drafted as ADR-0154 on the unmerged branch `feat/chat-conversation-context-layout`
(2026-11-04); that number went to another decision in the meantime, so it lands
here. Its stable head is taken as drafted; the batched history edits below are
new, from slice Q1 of [`quality-and-cost.md`](../design/international/quality-and-cost.md).

## Context and Problem Statement

A provider caches the prefix of a request and bills a cached token at a
twentieth of a new one (terra: $0.05 against $1.00 per million, a write $1.25).
A chat request is the tool schemas, the system prompt, the history, then one
turn context right before the newest question. That turn context carries the
inventory, the project and its memory, the office's instructions and lessons,
and what only the turn has (the date, the asker, the open file, the workspace).
Most of it is the same on every turn of a project, but it sits after the
history and is never stored, so every turn and every conversation sends it as
new tokens.

Measured on 2026-11-04:

* In production a follow-up's first call (p50 39.8 k prompt tokens) was as large
  as an opening turn's (37.1 k); 65 % of turns open a conversation, and an opening
  turn shares nothing with the project's other conversations past the system
  prompt. Hours with five or more turns by one person reached a 72 % cache share.
* Driven through the request builders with the tool schemas in front
  (`test_cross_turn_prefix.py`), a follow-up's first call sends 41 to 44 k new
  characters, and an opening turn shares 67 % (tool schemas and system prompt)
  with another conversation of the project.

## The north star

A conversation is a context that only grows: what holds for it is written once
at its head, each turn appends what it asked and what it read, nothing sent is
rewritten except at a compaction the budget forces. A follow-up, a resumed task
or a background turn woken hours later starts on a warm prefix and pays only for
what is new. This ADR takes the first step; the rest waits for production
numbers (see Slices).

## Decision Outcome

Chosen: the conversation layout (the chat agent's `context_layout.py`), on by
default, and history edited in steps rather than on every turn.

* The values the project and the office set (`CONVERSATION_VALUES`: the
  inventory of settled files, the project's profile, the office's
  instructions and lessons, OIB applicability, the parcel note, the per-tenant
  switches) are one `<conversation_context>` message right after the system
  prompt.
* What a turn varies (`TURN_VALUES`: the date, the asker, the open file and
  region, the trigger, the workspace, what was already read, the chosen skill
  and card shapes, the reference projects re-ordered for the question, the
  drafting switch of the turn's binding, the files still being read, and the
  one shelf a listing question asks about) stays the turn note, right before the
  question, request-only as before.
* The head carries a cache breakpoint of its own, the second after the system
  prompt's (`prompt_caching.cached_context_message`): a provider writes an entry
  only at a breakpoint, so without one the next turn would find the head's bytes
  but no entry ending there.
* The write-back and what is stored do not change. The history window does, in
  steps: older turns lose their tool results once per batch of
  `PRUNE_BATCH_TURNS` (4) turns rather than one turn later, and a window past
  its budget is cut to `TRIM_TO_SHARE` (62.5 %) of it rather than to the budget,
  so its start holds for several turns. Both are derived from the stored
  transcript alone (`history.window_start` replays it by each turn's prose-only
  size, which never changes once stored), because the agent keeps no state
  between turns. "Clearing invalidates the cache, so clear enough at once"
  (Anthropic, Context editing, on or after 2026-11-09).

Measured by the same test, re-run on this base on 2026-11-10: a follow-up's new
characters drop from 41,033 to 14,033, an opening turn shares 97.7 % (from
67.4 %) with the project's other conversations, and no round sends more than in
the turn layout. In a sixteen-turn conversation that outgrows its history
budget, 73 % of follow-ups repeat the previous turn past the head and the oldest
kept turn, against 33 % with the history edited on every turn.

### Confirmation

`test_context_layout.py` fails a template value in neither set, holds the
per-turn values out of the head, and checks the head is the same bytes for
another turn and another asker. `test_cross_turn_prefix.py` holds the two
measures above. In production `chat_cross_turn_cache_carry` (PostHog) is the
measure, and the ledger's `cache_write_tokens` (migration 0214) says what each
first call wrote. `CHAT_CONTEXT_LAYOUT=turn` is the rollback to the layout before.
`test_history.py::TestTheWindowMovesInSteps` and
`test_cross_turn_prefix.py::test_history_edited_in_batches_carries_most_follow_ups`
hold the history steps.

**Not yet confirmed by the answer suite.** Moving the project's facts before the
history changes what the model reads, and a turn can now carry up to three more
turns of (already compacted) tool results. The suite's OpenRouter key had no
credit on 2026-11-10, so `task be:eval:answer-suite` before and after is
outstanding; it is the gate for keeping both defaults.

## Considered Options

* **Keep the turn layout.** Every turn and conversation pays for the project
  context again.
* **Adopt deepagents or LangChain middleware.** Reviewed against the installed
  deepagents 0.7.32 and langchain 1.4.7: their prompt caching middleware acts on
  `ChatAnthropic` only and is a no-op on the OpenRouter `openai` clients this
  agent uses; `dynamic_prompt`, memory and skills middleware append per-turn text
  to the system message on every call, the opposite of a stable head;
  `ClearToolUsesEdit` and summarization rewrite the history at their trigger.
  Middleware also runs only inside `create_agent`, which this agent's own
  `StateGraph` (prefetch, withhold guards, steering) is not. Rejected while those
  hold; the stored compaction event of deepagents' summarization is the shape to
  borrow if the history ever needs compacting.
* **Store each turn's note with its question and move the window with it.**
  Built and measured: it saved a further ~1.8 k new tokens on a follow-up's first
  call but carried ~43 k more history that every round re-reads, which at a
  twentieth of the price cancels the saving by the seventh turn, and it changed
  what the clarifier and the deep-research hand-off receive. Rejected on that
  measurement; it returns only with a net win that counts the reads.

## Consequences

* Good: the largest part of every request, the project context, is cached
  across turns and across the project's conversations, at no extra token on
  any round.
* Bad: the project's facts sit before the history instead of right before the
  question; whether that changes answers is what the answer suite decides.
* Bad: between two prune steps a request carries up to three more turns of
  tool results (compacted to the cited passages), read from the cache at a
  twentieth of the price, and a window cut to 62.5 % holds up to 15 k tokens
  less history right after a step than one cut to the budget.
* Found by the independent review of the port, 2026-11-10: the project context
  carries the memory digest, which the BFF picks and orders by the question,
  so in the head it would have rewritten it on most turns. The head takes the
  profile only; the memory part (digest, proposal and review decisions, folder
  notes, the office's base knowledge) rides the turn note
  (`context_layout.split_project_context`, held by `test_context_layout.py`).
* Neutral: a settled upload or a changed profile rewrites the head once,
  and the history behind it, on the next turn.

## Slices

| Slice | What it buys | State |
|---|---|---|
| 0. Measure the carry | `chat_cross_turn_cache_carry`: the cached share of each answer's first call, opening turns and follow-ups apart | built (#1488) |
| 1. The stable head | this ADR | built, on by default (Q1) |
| 1b. History edited in steps | prune in batches, trim to a low watermark | built (Q1) |
| 2. Know what bounds the carry | split the carry by the gap since the previous turn (the endpoint's in-memory cache lasts minutes) | next |
| 3. Sticky routing for chat | ZDR chat calls carry the EU-first `provider.order`, which turns OpenRouter's sticky routing off; page reads moved to `provider.only` for that reason. Chat needs the non-EU fallback, so it needs another route to the same shard. Decide it on evidence first: the ledger keeps each call's `generation_id`, and OpenRouter's `GET /api/v1/generation?id=` names the endpoint that served it, so sampling the low-carry follow-ups of slice 2 shows whether they left the endpoint that holds the cache | open |
| 4. Retention that outlives a reading pause | where the endpoint offers it (OpenAI's 12 h retention writes at 2.5x), measured on slice 2's split | open |

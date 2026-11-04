---
status: proposed
date: 2026-11-04
decision-makers: Grid engineering, product owner
consulted: two independent architecture reviews (framework adoption; necessity and correctness), 2026-11-04
informed: everyone working in this repo
---

# What the project and the office set goes at the head of a chat request

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

Proposed: the conversation layout (the chat agent's `context_layout.py`).

* The values the project and the office set (`CONVERSATION_VALUES`: the
  inventory of settled files, the project context and memory, the office's
  instructions and lessons, OIB applicability, the parcel note, the per-tenant
  switches) are one `<conversation_context>` message right after the system
  prompt.
* What a turn varies (`TURN_VALUES`: the date, the asker, the open file and
  region, the trigger, the workspace, what was already read, the chosen skill
  and card shapes, the reference projects re-ordered for the question, the
  drafting switch of the turn's binding, the files still being read, and the
  one shelf a listing question asks about) stays the turn note, right before the
  question, request-only as before.
* Nothing else changes: the history window, the write-back, what is stored.

Measured by the same test: a follow-up's new characters drop to 14 to 17 k (a
third), an opening turn shares 98 % with the project's other conversations, and
no round sends more than in the turn layout.

### Confirmation

`test_context_layout.py` fails a template value in neither set, holds the
per-turn values out of the head, and checks the head is the same bytes for
another turn and another asker. `test_cross_turn_prefix.py` holds the two
measures above. In production `chat_cross_turn_cache_carry` (PostHog) is the
measure; nothing alerts on it yet. Behind `CHAT_CONTEXT_LAYOUT`, default `turn`
(byte-identical to before): moving the project's facts before the history
changes what the model reads, so it switches on with `task be:eval:answer-suite`
run before and after.

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
* **Store each turn's note with its question and move the window in steps.**
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
* Neutral: a settled upload or a changed memory note rewrites the head once,
  and the history behind it, on the next turn.

## Slices

| Slice | What it buys | State |
|---|---|---|
| 0. Measure the carry | `chat_cross_turn_cache_carry`: the cached share of each answer's first call, opening turns and follow-ups apart | built (#1488) |
| 1. The stable head | this ADR | built, off |
| 2. Know what bounds the carry | split the carry by the gap since the previous turn (the endpoint's in-memory cache lasts minutes) | next |
| 3. Sticky routing for chat | ZDR chat calls carry the EU-first `provider.order`, which turns OpenRouter's sticky routing off; page reads moved to `provider.only` for that reason. Chat needs the non-EU fallback, so it needs another route to the same shard | open |
| 4. Retention that outlives a reading pause | where the endpoint offers it (OpenAI's 12 h retention writes at 2.5x), measured on slice 2's split | open |

---
status: proposed
date: 2026-11-04
decision-makers: Grid engineering, product owner
consulted:
informed: everyone working in this repo
---

# A conversation is one context that only grows

## Context and Problem Statement

A provider caches the prefix of a request and bills a cache read at a twentieth
of an uncached token (terra: $0.05 against $1.00 per million, and a write at
$1.25). Within a chat turn every round extends the one before, so the rounds
hit. Across turns the cache carries only as far as the next turn's first
request repeats the previous turn's last one, and the agent rebuilds that
request every turn:

* the turn context sat right before the previous question and was never
  stored, so the next turn sends that question without it;
* the history window prunes the turn before last's tool calls every turn
  (`history.prune_tool_results`, `keep_turns=1`) and slides at its token budget.

Measured on 2026-11-04:

* Driven through the code that builds the requests (the agent's
  `test_cross_turn_prefix.py`), a follow-up repeats 31 %
  of what the turn before last sent: the system prompt and the first question.
* In production a follow-up's first call (p50 39.8 k prompt tokens) was as large
  as an opening turn's (37.1 k), most of it turn context, and hours with five
  or more turns by one person reached a 72 % cache share where a carried
  prefix gives about 86 %, though 87 of 101 follow-ups came within 30 minutes.
* The uncached part of a turn is about 85 % of what a chat turn costs.

The agent is becoming the colleague that works through a conversation over many
turns, tasks and resumptions. A layout that pays for its whole context again on
every turn makes each of those turns cost what the first did.

## The north star

A conversation is one context that only grows, the way a person's working
session does. Everything that holds for the whole conversation is written once,
at its head; each turn appends what it asked, what it was told about the moment,
what it read and what it answered; nothing already sent is rewritten except at a
compaction the budget forces, which then becomes the new head. A follow-up, a
steering note, a resumed task or a background turn woken hours later starts on a
warm prefix and pays only for what is new. The agent remembers what it read
without reading it again, and the cost of a conversation grows with what
happens in it, not with the number of turns.

## Decision Outcome

Proposed: the conversation layout (the chat agent's `context_layout.py`).

1. **What holds for the conversation comes first.** The blocks the project and
   the office set (the inventory, the project context and memory, the office's
   instructions, its reference projects and lessons, the per-tenant switches)
   are one `<conversation_context>` message right after the system prompt. The
   asker is not in it, so two members of one office share it too.
2. **What a turn varies stays with that turn.** The date, the asker, the open
   file and region, the trigger, the workspace, what was already read, the
   skill and card shapes chosen for the turn, and the answer-language line are
   the turn's note, sent right before its question as before, and now stored on
   the question (`additional_kwargs["turn_note"]`, written back under the
   question's id so the reducer replaces it in place) and sent again before it
   on every later turn.
3. **The window moves only when the budget makes it.** Every turn keeps its
   cited tool results until the history no longer fits; then the oldest turns
   are reduced to what was said, three at a time and never the previous turn.
   The turn layout's window stays the fallback.

The write-back is unchanged: the cited passages whole, the rest reduced to their
headers.

Measured by the same test: a follow-up repeats 85 % of the previous turn into
turn 2 and 88 to 93 % into turns 3 to 7, rising with the length of the
conversation, against 31 % for the turn layout.

### Behind a switch until the answer suite has measured it

`CHAT_CONTEXT_LAYOUT=conversation` turns it on; `turn` is the default and the
turn layout is byte-identical to before. The layout moves the project's facts
further from the question and keeps earlier evidence longer, which can change
answers, so the switch flips only with `task be:eval:answer-suite` run before
and after (`docs/contributing/testing-and-verification.md#the-answer-suite`).

### Confirmation

`test_cross_turn_prefix.py` drives conversations through the request builders,
the window and the write-back of both layouts and holds each to a floor: the
turn layout at 30 % (what it carries today), the conversation layout at 80 %
on every follow-up up to turn 7. A change that carries less fails it.
`test_context_layout.py` holds the parts: every template value in exactly one
part, the note stored under the question's id, the steering offset, a window
that keeps every result while it fits and prunes whole steps when it does not.
In production `chat_cross_turn_cache_carry` (PostHog) is the measure; nothing
alerts on it yet.

## Slices

| Slice | What it buys | Gate | State |
|---|---|---|---|
| 0. Measure the carry | `chat_cross_turn_cache_carry` in PostHog: the cached share of each answer's first agent call, opening turns and follow-ups apart (`llm_usage_by_outcome`) | none, it reads | done (#1488) |
| 1. The conversation layout | the three rules above, behind `CHAT_CONTEXT_LAYOUT` | answer suite before and after; the carry metric rises on follow-ups | built, off |
| 2. Snapshot the conversation context | a changed inventory or memory note appended as an update in the turn note instead of rewriting the head, so an upload mid-conversation costs its delta | slice 1 on | next |
| 3. Keep the prefix warm while the person reads | a cache retention that outlives the pause between turns where the endpoint offers one (OpenAI's 12 h retention is a 2.5x write): measure on the carry metric whether it pays | slice 1 on | open |
| 4. Background and resumed turns | a woken turn and a resumed task continue the conversation's transcript and head instead of starting a fresh request | slice 1 on | open |

## Consequences

* Good: a follow-up pays for its question, its note and the answer it follows,
  not for the whole context again. The longer the conversation, the larger the
  saving, which is where an agent that works over many turns spends.
* Good: the agent keeps the cited evidence of earlier turns until the budget
  needs the room, so a follow-up needs fewer repeat fetches.
* Good: the system prompt stays the static half alone; nothing per-turn enters it.
* Bad: the transcript stores each turn's note, a few hundred to a few thousand
  tokens per turn, read from the cache at a twentieth of its price.
* Bad: the project's facts sit before the history instead of right before the
  question. Whether that changes answers is what the answer suite decides.
* Neutral: a change to the conversation context (an upload, a memory note)
  rewrites the conversation once on the next turn until slice 2.

## Considered Options

* **Keep the turn layout.** Every turn pays for its context again: rejected on
  the numbers above.
* **Store the whole turn context with each turn.** Carries the prefix, but
  repeats the inventory and the project in every turn and fills the history
  budget in a few turns, which forces the rewrites it was meant to avoid.
* **Compaction by the provider** (OpenAI's server-side compaction, Anthropic's
  context editing). Both rewrite the prefix when they act and are tied to one
  vendor's API; the layout keeps the decision of what to keep in this code,
  where the model a tenant chooses can change.

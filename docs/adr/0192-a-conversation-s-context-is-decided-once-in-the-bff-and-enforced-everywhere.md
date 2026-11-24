---
status: proposed
date: 2026-11-24
decision-makers: product owner (Matthias)
consulted: [`docs/audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md) (the code as it is), [`docs/audit/shared-ai-context-elsewhere-2026-11.md`](../audit/shared-ai-context-elsewhere-2026-11.md) (other products and published patterns), an adversarial review of the first draft against the code
informed: everyone who touches retrieval, memory, sharing, the agent-api or the Python agent
---

# A conversation's context is decided once per turn, in the BFF, and enforced everywhere

## Context and Problem Statement

What a chat turn may draw on depends on who reads the chat, and that is decided
many times today:

- the audience row is read at fifteen call sites in the BFF;
- solo or shared is decided at five points;
- the search scope is signed when the chat's socket opens and stays valid for up
  to six hours (`REQUEST_CONTEXT_MAX_AGE_MS`), across every turn on that socket;
- personal memory is gated in one service, workspace reads in another, widening
  in a third;
- runs build their scope apart;
- the prompt states a rule the code does not hold;
- the Python side allows more, not less, when its context is missing.

Every new source would have to be taught to all of these, and ADR-0191's
personal shelf is the next one. A scope that lives as long as a socket would also
keep the personal shelf in a chat after it was shared.

## Decision

1. **One function decides, once per turn.** `resolveConversationContext` in the
   BFF returns one `ConversationContext`:
   - the audience and its version;
   - the project, from the conversation row;
   - what the turn may draw on;
   - what the chat has already drawn on.

   It runs in a light per-turn call (`turn-decision`) that the agent makes before
   it reads any scope, where the restricted-use pre-check runs today, and it
   returns a decision signed for this turn. The prompt blocks (`turn-context`)
   read that decision instead of re-deciding. Only the scope leaves the socket's
   envelope. Runs are decided at submit and at each envelope renewal. Every rule
   the turn follows comes from this one value: the scope, memory, workspace reads,
   the prompt's audience line, features, and what a run may draw on.
2. **The BFF decides, because it alone holds the facts.** Identity, project roles,
   grants, folder restrictions and the per-user row-level policies live in the BFF
   and WorkOS. The Python service holds none of them.
3. **Python enforces and never re-derives.** It binds the turn's decision once,
   into a frozen run context that never enters a prompt. Where a read shapes an
   answer, it fails closed: with no valid decision it reads nothing, and an empty
   scope stays empty. The bound scope never widens during a turn. It keeps what only it can
   see: which sources a tool actually read, reported back the way restricted folders
   are today (`admit`).

   The routes that legitimately run without an envelope keep their own guard:
   the eight exempt prefixes of the envelope middleware, ingestion, and the
   worker identity headers.
4. **A changed audience narrows; it does not stall.** `conversations` gains an
   `audience_version`. Triggers bump it on any change of visibility, creator,
   project or grants, and raise if the bump is lost. The context carries the
   version it was decided under, so a live check is one primary-key read.

   Writes and widening keep taking the audience lock and comparing the version. A
   chat with no row yet carries version `null`, which keeps today's `'new'`
   rule; `0` is an ordinary version and never means alone.

   On a mismatch the BFF re-resolves and the turn continues under the narrower
   of the two contexts. Only a read or write that would cross the new audience is refused.
5. **Every caller has a kind, and each kind's reach is stated.** The kinds are
   derived from the code's existing `CallDoor` and `SessionSource`:
   - `chat`: a turn in a conversation, including wake turns and asks;
   - `run`: tasks and deep research;
   - `headless`: document check, intake, jobs that serve no reader;
   - `external`: the `mcp`, `a2a` and `platform` doors and `script` sessions.

   The built-in agent's door is `chat`, `run` or `headless`, by what started it.

   Nothing without a conversation gets personal memory or the personal shelf,
   and neither does an external caller. A run never gets the personal shelf.
   A missing row reads as solo, so solo alone never grants anything personal. The table is in the design.

   These rules govern what a context draws on by itself. Explicit operations on a
   person's own shelf are different: through the `mcp` door, the person's own
   connected agent may upload to, list, search and read their own Meine Ablage
   with their rights, as they could by hand. The `a2a` and `platform` doors may
   not.

## Consequences

* ADR-0191's personal shelf is one predicate and one recorded source here. The
  personal shelf is used only where the chat has no project and its owner alone
  reads it. Personal memory follows ADR-0180: wherever the asker alone reads the
  chat.
* Each answer keeps a server-written record of the context it was decided under
  and what it actually read. That record is what makes new features possible:
  „Gelesen“ under an answer, withheld sources for someone who joins later, a
  preview before sharing, asking privately in a shared chat
  (`conversation-context.md`, „What it makes possible“).
* The upgrade cache in `server.js` stops holding a scope. It keeps caching the
  rest of the answer and keeps its cap on concurrent upgrades.
* The workspace block's line about shared chats is generated from the context, so
  the prompt and the code cannot disagree.
* A turn without a conversation no longer receives personal memory, which it
  does today (`loadPersonalMemory` loads it when `conversationId` is absent).
* `isShared` (viewer-independent; it decides whether a chat is local-first or
  server-held, ADR-0033) and solo (relative to the asker) stay two predicates over
  one shared primitive. Merging them would move chats between storage models.
* Features (deep research, tasks) are carried in the same decision as
  entitlement and not confined, so a short BFF outage no longer opens them, and a
  turn on restricted folders keeps them off as `settle_restriction` does today.

### Confirmation

* A guard spec: the audience is read only by the context module and by locked
  writers.
* A turn's collections follow the conversation row whatever the request names.
* A chat shared between two turns no longer draws on the personal shelf in the
  second turn.
* The agent reads nothing when the turn's decision is missing or unsigned.
* A stale `audience_version` narrows the turn instead of refusing it.
* A run without a conversation, a headless job or an external call never
  receives personal memory or the personal shelf; a run with a conversation
  receives personal memory only where that chat's turn would, and never the
  personal shelf.
* An `mcp` caller reaches only its own person's shelf, and an `a2a` or
  `platform` caller reaches no personal-shelf operation.
* The TypeScript, CommonJS and Python sides parse one generated schema fixture.

The design, the migration order and the slices are in
[`docs/architecture/conversation-context.md`](../architecture/conversation-context.md).

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

- the audience row is read at sixteen call sites in the BFF;
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

   The per-turn call the agent already makes (`POST /api/internal/turn-context`)
   is where it runs. That call returns the decision with a freshly signed scope for
   this turn. The socket's envelope carries identity only. Every rule the turn
   follows comes from this one value: the scope, memory, workspace reads, the
   prompt's audience line, and what a run may draw on.
2. **The BFF decides, because it alone holds the facts.** Identity, project roles,
   grants, folder restrictions and the per-user row-level policies live in the BFF
   and WorkOS. The Python service holds none of them.
3. **Python enforces and never re-derives.** It binds the turn's decision once,
   into a frozen run context that never enters a prompt. Where a read shapes an
   answer, it fails closed: with no valid decision it reads no project, personal or
   restricted source, and an empty scope stays empty. It keeps what only it can
   see: which sources a tool actually read, reported back the way restricted folders
   are today (`admit`).

   The routes that legitimately run without an envelope keep their own guard:
   ingestion, drafts and job actions.
4. **A changed audience narrows; it does not stall.** `conversations` gains an
   `audience_version`. Triggers bump it on any change of visibility or grants. The
   context carries the version it was decided under, so a live check is one
   primary-key read.

   Writes and widening keep taking the audience lock and comparing the version. A
   new chat's `0` counts as its creator alone, as `'new'` does today.

   On a mismatch the BFF re-resolves and the turn continues under the narrower
   context. Only a read or write that would cross the new audience is refused.
5. **Every caller has a kind, and each kind's reach is stated.**
   - `chat`
   - `run` (tasks, deep research)
   - `headless` (document check, wake jobs, agent asks)
   - `external` (an MCP client)

   An external client never draws on personal sources.

## Consequences

* ADR-0191's personal shelf is one predicate and one recorded source here. The
  personal shelf is used only where the chat has no project and its owner alone
  reads it. Personal memory follows ADR-0180: wherever the asker alone reads the
  chat.
* The socket's scope cache in `server.js` loses its reason to exist, because the
  scope no longer lives on the socket.
* The workspace block's line about shared chats is generated from the context, so
  the prompt and the code cannot disagree.
* `isShared` (viewer-independent; it decides whether a chat is local-first or
  server-held, ADR-0033) and solo (relative to the asker) stay two predicates over
  one shared primitive. Merging them would move chats between storage models.
* Feature entitlements (deep research, tasks) are carried in the same per-turn
  answer, so a short BFF outage no longer opens them. They are not audience rules
  and keep their own source.

### Confirmation

* A guard spec: the audience is read only by the context module and by locked
  writers.
* A turn's collections follow the conversation row whatever the request names.
* A chat shared between two turns no longer draws on the personal shelf in the
  second turn.
* The agent searches nothing when the turn's decision is missing or unsigned.
* A stale `audience_version` narrows the turn instead of refusing it.
* The TypeScript, CommonJS and Python sides parse one generated schema fixture.

The design, the migration order and the slices are in
[`docs/architecture/conversation-context.md`](../architecture/conversation-context.md).

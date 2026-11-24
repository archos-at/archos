---
status: proposed
date: 2026-11-24
decision-makers: product owner (Matthias)
consulted: [`docs/audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md) (the code as it is), [`docs/audit/shared-ai-context-elsewhere-2026-11.md`](../audit/shared-ai-context-elsewhere-2026-11.md) (other products and published patterns)
informed: everyone who touches retrieval, memory, sharing, the agent-api or the Python agent
---

# A conversation's context is decided once, in the BFF, and enforced everywhere

## Context and Problem Statement

What a chat turn may draw on depends on who reads the chat. Today that is
decided many times. The audience row is read at sixteen call sites in the BFF,
at least eight times in one turn. Solo or shared is decided at five points, and
each decision comes from a fresh read. The search scope is built from the
`projectId` the browser sends. Personal memory is gated in one service, workspace
reads in another, widening in a third. Runs and jobs build their scope by a
separate path, and the prompt states a rule the code does not hold. On the Python
side, a missing signature, an unsigned header or an empty scope each make the
agent allow more rather than less.

Each piece is reasonable on its own. Together they drift, and every new source
(ADR-0191's personal shelf is the next) would have to be taught to five places.

## Decision

1. **One function decides the context.** `resolveConversationContext` in
   `apps/workspace/bff/conversation-context/` returns one `ConversationContext`
   per turn or run. The context holds:
   - the audience: its row, `solo`, its readers and `audienceKey`;
   - whether the chat has a server row yet;
   - the project, taken from the conversation row once one exists, never from the
     page;
   - what the turn may draw on: shelves and collections, restricted collections,
     other projects, personal memory, project-memory folders and the kind of
     workspace read;
   - what the chat has already drawn on.

   It is the only definition of solo and the only reader of the audience outside
   a locked transaction.
2. **The BFF decides, because it alone holds the facts.** Identity, project
   roles, grants, folder restrictions, flags and the per-user row-level policies
   all live in the BFF and WorkOS. The Python service holds none of them and would
   need a second authorization stack to decide.
3. **Python enforces and never re-derives.** The decision travels in the signed
   request envelope, together with its `audienceKey`, as a typed contract. One zod
   schema produces a generated JSON schema, and a TypeScript and a Python spec
   both assert it. Python reads it once into a frozen run context that is never
   put into a prompt.

   Python fails closed:
   - with no valid signature, it reads no project, personal or restricted source;
   - an empty scope stays empty;
   - unknown flags mean no.

   It keeps what only it can see: which sources a tool actually read
   (`admit_tool_results`) and the restriction judge.
4. **Writes stay locked and keyed.** Every record and every widening takes the
   existing audience lock. It re-reads the audience and refuses when the live
   `audienceKey` differs from the one the turn was decided under. Every call
   Python makes back into the BFF on behalf of the turn does the same check, so a
   change of audience mid-turn is caught on every path, not only two.
5. **Runs and jobs use the same function.** They pass no conversation, and what
   they may draw on is stated rather than left out by accident.

## Consequences

* The personal shelf and the personal-use record of ADR-0191 are one predicate
  and one recorded source in this function. They are not new rules spread across
  services.
* About eight audience reads per turn become one, plus the locked re-read where
  something is written. The restricted-use pre-check from Python and one of the
  two duplicated restricted-collection functions go away. The browser-supplied
  project, the `active_project_id` fallback and the unsigned header fallbacks go
  too.
* The 10-second scope cache in `server.js` is keyed on the audience, so sharing a
  chat no longer serves the old scope.
* The workspace block's line about shared chats is generated from the context,
  so the prompt and the code cannot disagree.

### Confirmation

Specs, each naming the rule it holds:
- A grep-level guard: `readConversationAudience` is called only from the
  context module and from locked writers.
- A turn's collections follow the conversation row whatever `projectId` the
  request carries.
- The Python agent searches nothing but the base corpus when the envelope is
  missing, unsigned, or carries an empty scope.
- A write under a stale `audienceKey` is refused on every internal route the
  agent calls.
- The TypeScript and Python sides parse the same generated schema fixture.

The design and its slices are in
[`docs/architecture/conversation-context.md`](../architecture/conversation-context.md).

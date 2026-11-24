# The conversation context

Status: design, decided in [ADR-0192](../adr/0192-a-conversation-s-context-is-decided-once-in-the-bff-and-enforced-everywhere.md) (proposed). Not built yet. The evidence it rests on, with file and line, is in
[`audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md).

For one turn or run, a single value answers who reads it, what it may draw on,
and what it has already drawn on. It is decided once per turn. Everything that
needs an answer reads this value, and nothing else re-derives it.

## The value

A new module, `conversation-context`, sits in the BFF beside `conversations` (files `types.ts`, `resolve.ts`, `record.ts`, `index.ts`):

```ts
resolveConversationContext(
  session: AuthorizedSession | null,
  request: { conversationId?: string; projectId?: string; kind: 'chat' | 'run' | 'headless' | 'external' },
  options?: { audience?: AudienceRead }, // a locked writer passes the read it holds
): Promise<ConversationContext>

interface ConversationContext {
  kind: 'chat' | 'run' | 'headless' | 'external'
  audience: { row: ConversationAudienceRow; solo: boolean; version: number }
  projectId: string | null       // the row's; before the row exists, what the client is creating
  may: {
    shelves: ScopedCollection[]  // always sent, possibly empty: base, office shelf, project, personal, session
    restrictedCollections: string[]
    otherProjects: { projectIds: string[]; restrictedFolders: boolean }
    personalMemory: boolean
    personalShelf: boolean
    projectMemory: { readableFolderIds: string[] }
    workspaceRead: 'none' | 'document+projectFacts' | 'all'
    features: { deepResearch: boolean; tasks: boolean }
  }
  recorded: { folders: string[]; projects: string[]; personalShelf: boolean }
}
```

There is no list of readers. A project-visible chat's readers are the project's
members, and they change outside the conversation. Each turn resolves the
audience afresh.

**Predicates, each defined once in `types.ts`:**
- `solo`: the existing `isSoloAudience`, unchanged.
- `may.personalMemory = solo`, as ADR-0180 holds today. A solo project chat keeps
  personal memory.
- `may.personalShelf = solo && projectId === null && kind !== 'external'`, per
  ADR-0191.
- `isShared` in `bff/sharing/access.ts` stays viewer-independent. It decides
  local-first versus server-held (ADR-0033), and it is rewritten over the same
  primitive as `solo` rather than merged with it.

## Where it is decided: the per-turn call

`POST /api/internal/turn-context` (`bff/turn-context/service.ts`, `wire.ts`)
already runs once per turn and already reads the audience. It becomes the single
decision point:
1. It calls `resolveConversationContext`.
2. It returns the prompt blocks the context allows, as now.
3. It also returns the decision, with a scope signed for this turn (`issuedAt`,
   `conversationId`, `audience_version`).

Python binds it once per turn. Retrieval reads that scope, not the socket's.

The socket's envelope keeps identity: organization, user and conversation. The
scope that `server.js` signs at upgrade time goes away, and with it the
10-second scope cache and its blind spot.

## Who reads it instead

| Today | Reads instead |
|---|---|
| `resolveTurnContext`, `buildCollectionScopeFromRequest`, `computeCollectionScope`, `resolveRestrictedCollections` | `resolveConversationContext`; `computeCollectionScope` stays as the pure ordering behind `may.shelves` |
| `restrictedCollectionsForChatScope` and `drawableRestrictedCollections` (one question, two functions) | one function behind `may.restrictedCollections` |
| `loadTurnContext`, `readSoloAudience`, `loadPersonalMemory`, the `checkAccess` repeat | `may.personalMemory` and the access the context checked |
| `workspace-block.ts` audience line | generated from `may.workspaceRead` |
| `conversationAudienceOf`, `proposalReachRefusal`, `reachOver`, `search/reach.ts` | the context; `judgeWorkspaceRead` keeps its per-target check |
| `buildProjectMemoryDigest` with and without a folder filter | always with `may.projectMemory` |
| `jobs/run-context.ts` (no office shelf, no audience); `backend-operations.ts`, the wake job, document check, agent asks | the same function with their `kind` |
| Python `begin_restricted_use` (the per-turn drawability ask) | the per-turn decision |
| Python `stages/flags.py` (fails open on a BFF outage) | `may.features` |

## The audience version

`conversations.audience_version integer not null default 0`, bumped by triggers
on:
- an update of `visibility` or `created_by`;
- an insert or delete in `resource_shares` for that conversation.

It replaces the string `audienceKey`. A new chat's first turn may run before its
row exists, because `_appendMessage` is not awaited. The context then carries
version `0` and counts as its creator alone, as `'new'` does in
`recordCrossProjectHandOut` today.

- **Writes** take `lockConversationAudience`, compare the version, and record or
  refuse:
  - `recordCrossProjectHandOut`;
  - `admitSourceFolders`;
  - the personal-shelf record;
  - `widenConversationAudience`.
- **A call from the agent on behalf of a turn** compares one integer. On a
  mismatch it re-resolves the context and continues under it; it refuses only
  what the new audience may not reach.

## Recording personal use

Python reports what a tool actually read. The `admit` callback that serves
restricted folders today also takes personal collections. The BFF writes
`recorded.personalShelf`, and `widenConversationAudience` asks the owner when it
is set.

The personal-memory digest is injected into every solo turn, so recording it
would make every share ask. It is not recorded. Once a chat is shared, the next
turn no longer injects it (rule 4 of ADR-0180, fresh each turn). Earlier answers
may still reflect the owner's preferences, a risk this design accepts.

## Python enforces

These apply to reads that shape an answer:
- `RequestContext.from_envelope` refuses an unsigned envelope when
  `INTERNAL_API_TOKEN` is unset. Local development gets a dev token and a signing
  helper for tests first.
- `project_context.from_context` and `from_headers` and
  `scoping._raw_collection_scope_from_header` stop falling back to plain
  `x-grid-*` headers.
- `knowledge_layer/search/scope.py` treats an empty scope as empty. Today
  `if header_scope:` falls through to the config path.

These keep their own guards and are not touched by fail-closed:
- the internal-token routes exempt from the envelope (`/v1/documents`,
  `/v1/drafts`, `/v1/jobs/async/job`);
- ingestion;
- the worker identity headers.

## Migration order

1. **The BFF computes the context and dual-writes.** The per-turn response gains
   the decision and the signed turn scope. The socket envelope still carries the
   old scope. `turn-headers.js` (CommonJS) and `request-context.ts` sign the same
   bytes, so both join the generated contract.
2. **Python reads the per-turn decision.** It falls back to the old envelope
   scope only inside a valid signature.
3. **The old fields are dropped**, after at least six hours (the envelope's
   lifetime), after queued jobs holding old envelopes have drained, and in step
   with the header rename that `legacy_headers.py` already schedules. That is when
   the upgrade-time scope, the scope cache, the plain-header fallbacks and
   `begin_restricted_use` go.

## Slices

1. **The module, its BFF consumers and `audience_version`.** The per-turn response
   carries the decision, dual-written. The guard spec allows the audience to be
   read only by the module and by locked writers. Builds on
   [#1899](https://github.com/archos-at/archos/pull/1899), which already takes a
   turn's project from the row.
2. **Python binds the per-turn decision and fails closed on answer-shaping
   reads**, under the generated contract (TypeScript, CommonJS, Python).
3. **The old paths are dropped**, per the migration order, and runs, headless and
   external callers move onto `kind`.
4. **ADR-0191 on top:** `may.personalShelf`, the personal admit callback,
   `recorded.personalShelf`, and the owner's confirmation in
   `widenConversationAudience`.

Each slice changes what shapes an answer and runs the golden run on dev before
and after (`docs/contributing/testing-and-verification.md`). The decision
(kind, solo, shelves, personal memory and shelf on or off, audience version)
goes on the turn's Langfuse trace.

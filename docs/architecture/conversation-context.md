# The conversation context

Status: design, decided in [ADR-0192](../adr/0192-a-conversation-s-context-is-decided-once-in-the-bff-and-enforced-everywhere.md) (proposed). Not built yet. The evidence it rests on, with file and line, is in
[`audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md).

One value answers three questions for a chat turn or a run:

- who reads it;
- what it may draw on;
- what it has already drawn on.

Everything that needs one of the answers reads this value. Nothing else
re-derives it.

## The value

A new module, `conversation-context`, in the BFF beside `conversations` (files `types.ts`, `resolve.ts`, `record.ts`, `index.ts`):

```ts
resolveConversationContext(
  session: AuthorizedSession | null,
  request: { conversationId?: string; projectId?: string; kind: 'chat' | 'run' | 'job' },
  options?: { audience?: AudienceRead }, // a locked writer passes the read it holds
): Promise<ConversationContext>

interface ConversationContext {
  audience: { row: ConversationAudienceRow; solo: boolean; readers: string[]; key: string }
  persisted: boolean               // false: a private chat with no server row yet (ADR-0033)
  projectId: string | null         // the row's once persisted; the request's only before that
  may: {
    shelves: ScopedCollection[]    // base, office shelf, project, personal (ADR-0191), session
    restrictedCollections: string[]
    otherProjects: { projectIds: string[]; restrictedFolders: boolean }
    personalMemory: boolean
    projectMemory: { readableFolderIds: string[] }
    workspaceRead: 'none' | 'document+projectFacts' | 'all'
  }
  recorded: { folders: string[]; projects: string[]; personal: boolean }
}
```

The type grows out of `ConversationAudience` in
`bff/agent-api/conversation-audience.ts`, which already holds `{row, solo, key}`.
`isSoloAudience` and `audienceKey` move into `types.ts` and stay the only
definitions. `isShared` in `bff/sharing/access.ts` is redefined over them, so the
UI and the agent mean the same thing by shared.

**One predicate for everything personal:**

`onlyOwnerReads = projectId === null && (persisted ? solo : true)`

It sets `may.personalMemory`, and it adds the personal shelf to `may.shelves`. A
project chat never draws on the personal shelf (ADR-0191, rule 4). Personal
memory in a solo project chat keeps today's rule from ADR-0180 until the product
owner decides otherwise.

## Who reads it

| Today | Reads instead |
|---|---|
| `resolveTurnContext`, `buildCollectionScopeFromRequest`, `computeCollectionScope`, `resolveRestrictedCollections` | `resolveConversationContext`; `computeCollectionScope` stays as the pure ordering behind `may.shelves` |
| `restrictedCollectionsForChatScope` and `drawableRestrictedCollections` (the same question twice) | one function behind `may.restrictedCollections` |
| `loadTurnContext`, `readSoloAudience`, `loadPersonalMemory`, the `checkAccess` repeat | `may.personalMemory`, and the access the context already checked |
| `workspace-block.ts` audience line | generated from `may.workspaceRead` |
| `conversationAudienceOf`, `proposalReachRefusal`, `reachOver`, `search/reach.ts` | the context. `judgeWorkspaceRead` keeps its per-target check |
| `buildProjectMemoryDigest` called with and without a folder filter | always with `may.projectMemory` |
| `jobs/run-context.ts` scope without office shelf or audience | the same function with `kind: 'run'` or `'job'` |
| `server.js` scope cache keyed on cookie, project, conversation | keyed on `audience.key`, or off for persisted chats |

## How it travels to Python

The signed envelope (`bff/request-context.ts`, `buildRequestContextEnvelope`)
carries `may.shelves`, `may.restrictedCollections`, `may.personalMemory`,
`may.workspaceRead` and `audience.key`. `recorded` and the readers stay in the
BFF. The envelope warning at 12 KiB (`RUN_ENVELOPE_WARN_BYTES`) still applies.

**The contract.** The schema is zod in the BFF, and a generated JSON schema sits
beside `apps/workspace/tests/fixtures/request_context.json`. A TypeScript spec
and `packages/agent/tests/test_project_context.py` both parse it. The
hand-mirrored `TurnContext` dataclass and `RequestContext` fields follow the
schema.

**Python enforces, and fails closed:**
- `RequestContext.from_envelope` refuses when `INTERNAL_API_TOKEN` is unset,
  instead of accepting an unsigned envelope.
- `from_context` and `from_headers` stop falling back to the plain
  `x-grid-*` headers. `knowledge/scoping.py` drops `_raw_collection_scope_from_header`.
- `knowledge_layer/search/scope.py` treats an empty header scope as empty: today
  `if header_scope:` falls through to the config path.
- `stages/flags.py` stops defaulting deep research and tasks to allowed when the
  BFF cannot be reached.
- `restricted_use.begin_restricted_use` stops asking the BFF what the envelope
  already says. `admit_tool_results` and the hand-out recording stay: only Python
  sees what a tool actually read.
- `draft_namespace` gains the organization, so drafts do not rest on the
  conversation id alone.

## Writes and a changing audience

The context is a snapshot. The decisions that write still take
`lockConversationAudience`, re-read the audience inside the transaction and
compare `audienceKey`:
- `recordCrossProjectHandOut`, `admitSourceFolders`;
- the personal record (ADR-0191);
- `widenConversationAudience`.

Every internal route the agent calls on behalf of a turn compares the envelope's
key with the live one and refuses with `CrossProjectAudienceChangedError` when
they differ. This includes personal memory, `remember`, document reads and
proposals.

## Slices

1. **The module and the BFF consumers.**
   - No behaviour change except that the project comes from the row.
   - Removes `active_project_id`.
   - Keys the `server.js` cache on the audience.
   - Adds the guard that only the module and locked writers read the audience.
2. **The envelope carries the decision, and Python enforces it.**
   - Covers the contract, the fail-closed paths and the removed pre-check.
3. **Runs and jobs on the same function.**
4. **ADR-0191 on top:** the personal shelf in `may.shelves`, the personal
   record, and the owner's confirmation in `widenConversationAudience`.

Each slice changes what shapes an answer and runs the golden run before and
after (`docs/contributing/testing-and-verification.md`). The context's decision
(audience kind, shelves, personal memory on or off) goes on the turn's trace in
Langfuse.

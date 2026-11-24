# The conversation context

Status: design, decided in [ADR-0194](../adr/0194-a-conversation-s-context-is-decided-once-in-the-bff-and-enforced-everywhere.md) (proposed). Not built yet. The evidence it rests on, with file and line, is in
[`audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md).
Reviewed twice against `develop` by independent agents. Their blockers are folded
in below.

For one turn or run, a single value answers three questions: who reads it, what
it may draw on, and what it has already drawn on. It is decided once per turn,
before anything in the turn reads a scope. Everything that needs an answer reads
this value, and nothing else re-derives it.

## The value

A new module, `conversation-context`, sits in the BFF beside `conversations`.
Its files are `types.ts`, `resolve.ts`, `record.ts`, `wire.ts` and `index.ts`.

```ts
type ContextKind = 'chat' | 'run' | 'headless' | 'external'

resolveConversationContext(
  session: AuthorizedSession | null,
  request: { conversationId?: string; projectId?: string; kind: ContextKind },
  options?: { audience?: AudienceRead }, // AudienceRead = { tx: Tx; row: ConversationAudienceRow }, held under the lock
): Promise<ConversationContext>

interface ConversationContext {
  kind: ContextKind
  conversationId: string | null
  audience: { row: ConversationAudienceRow; solo: boolean; version: number | null } // null: no row yet
  projectId: string | null       // the row's; before the row exists, the project the client is creating
  may: {
    shelves: ScopedCollection[]  // always present, possibly empty: base, office shelf, project, personal, session
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

The context carries no list of readers. A project-visible chat's readers are the
project's members, and they change outside the conversation, so each turn
resolves the audience afresh.

The decision is never advisory. If it cannot be resolved, the turn fails closed:
no personal memory, no personal shelf, and no project, restricted or
other-project source. Today `readSoloAudience` swallows its errors; this design
does not.

## What each kind may draw on

`kind` is derived from the vocabulary the code already has
(`bff/agent-api/call-door.ts`: `CallDoor`, `SessionSource`); it is not a second
one. A signed envelope without a kind reads as `chat` (envelopes signed before the kind existed); a kind that is present but unknown is refused, never widened.

| Kind | Who | Base, office shelf, project | Restricted folders, other projects | Personal memory | Personal shelf |
|---|---|---|---|---|---|
| `chat` | a turn in a conversation, including a wake turn and an agent's ask in a chat | yes | what every reader may read | when `solo` | when `solo` and the chat has no project |
| `run` | tasks and deep research; with a conversation in the run's own project, that chat's audience; a chat in another project or in none counts as no conversation | yes, with the office shelf | none, with or without a conversation: a run's decision lives up to an hour | as `chat` when it has a conversation, otherwise no | no: a run's decision lives up to an hour, past a share |
| `headless` | document check, project intake, wake stop, jobs that serve no reader | the project only; its workspace read is the one document it serves and the project's facts | none | no | no |
| `external` | the `mcp`, `a2a` and `platform` doors and `script` sessions; the built-in agent's door is `chat`, `run` or `headless` by what started it | yes, with the caller's rights, through the agent-api | through the agent-api's per-target checks | no | never drawn into a context; through the `mcp` door the person's own agent may upload to, list, search and read their own shelf, through `a2a` and `platform` nothing |

**The predicates.** Each is defined once, in `types.ts`.
- `solo`: the existing `isSoloAudience`, unchanged. It is true for a missing row,
  so on its own it never grants anything personal.
- `may.personalMemory = solo && conversationId !== null && (kind === 'chat' || kind === 'run')`.
  ADR-0180 holds for chats as it does today: a solo project chat keeps personal
  memory.
- `may.personalShelf = may.personalMemory && projectId === null && kind === 'chat'`, per ADR-0193.
- `may.features = entitlement && !confined`. A turn that draws on restricted
  folders keeps deep research and tasks off, as `settle_restriction` does today.
- `isShared` in `bff/sharing/access.ts` stays viewer-independent. It decides
  local-first versus server-held (ADR-0033). It is rewritten over the same
  primitive as `solo` but not merged with it.

## Where it is decided

**Two calls per turn, one decision.**
1. **`POST /api/internal/turn-decision` (new, light).** It is called where
   `begin_restricted_use` runs today (`core/conversation_register.py`), before
   any scope is read: before `get_scoped_collections_from_context`, the loading
   step and `load_inventory`. It calls `resolveConversationContext` and returns
   the signed decision. It replaces the restricted-use pre-check: since slice
   3b, `/api/internal/conversations/[id]/restricted-use` only admits (`admit`),
   and the answer's mark comes from the decision's record.
2. **`POST /api/internal/turn-context` (as now).** It returns the prompt blocks,
   in parallel with the inventory, and reads the decision's `may.*` rather than
   re-deciding.

After slice 3, Python reads scope in exactly one place,
`scoping.get_scoped_collections_from_context`. Of the eight other modules that
read `.collection_scope` or `.collection_scope_entries` today, the ones that shape
an answer move in slice 2 and the rest in slice 3.

The socket's envelope keeps everything it carries except `collectionScope`:
identity, the project for a chat whose row is not there yet, budget, model
overrides, federal state and requester. The `server.js` upgrade cache keeps
caching that answer and its cap of 32 concurrent upgrades. It just no longer
holds a scope. Since slice 3b the envelope signs no `collectionScope`, and the
upgrade decides no shelves (`resolveTurnContext` with `shelves: false`).

**Runs** are decided at submit and at every envelope renewal
(`renewRunEnvelope`, hourly). They are not decided at the socket.

## The audience version

`conversations.audience_version integer not null default 0`. Existing rows start
at 0 and need no backfill. Triggers bump it on:
- an update of `visibility`, `created_by` or `project_id`. The last keeps moving
  a chat between Persönlich and a project possible.
- an insert, an update (grants are written by upsert,
  `sharing/repository.ts`) or a delete in `resource_shares` where
  `resource_type = 'conversation'`. `resource_id` is text.

A trigger raises when the conversation it should bump exists but is not
updated; a grant deleted after its conversation (`deleteOrphanedGrants`,
`purgeResourceCollaboration`) has nothing to bump. A lost bump can
happen under `grid_app_rw` with a tenant mismatch, and a silently lost bump would
fail open.

A change of project membership does not bump the version, and neither does
`audienceKey` today. Membership is caught by the next turn's fresh resolve.

`audience.version` is `null` when no row exists yet. A new chat's first turn can
run before `_appendMessage` (not awaited) has created the row. `null` keeps
today's `'new'` rule: a write under `null` is accepted only if the row, once it
exists, is solo for the asker. `0` is an ordinary version and never means alone.

**What compares the version:**
- **Writes** take `lockConversationAudience`, re-read the audience and compare,
  then record or refuse. That covers `recordCrossProjectHandOut`,
  `admitSourceFolders`, `projects/folder-bin.ts`, and the personal-shelf record.
  `widenConversationAudience` takes the lock and, through its triggers, bumps.
- **Reads never widen during a turn.** The bound scope only narrows, through
  admit-before-use for audience-dependent collections (restricted, personal), as
  `RestrictedUse.drawable` already does. A mismatch seen by an agent-api call
  re-resolves and continues under the narrower of the two contexts; it refuses only what the
  new audience may not reach.

## Recording personal use

Python reports what a tool actually read. The `admit` callback that serves
restricted folders today also takes personal collections. The BFF writes
`recorded.personalShelf`, and `widenConversationAudience` asks the owner first
when it is set.

The personal-memory digest is injected into every solo turn in a conversation, so recording it
would make every share ask. It is not recorded. Once a chat is shared, the next
turn no longer injects it (ADR-0180, rule 4, fresh each turn). Earlier answers
may still reflect the owner's preferences, a risk this design accepts.

## The record per answer

The record per chat (`conversation_source_projects`,
`conversation_restricted_folders`, the personal-shelf record) says what a chat
drew on, but not which answer did. Next to it, the context keeps one row per
answer, written by the BFF and never by the browser:
- the kind and the audience version the turn was decided under;
- the places it was allowed to read;
- what it actually read, as reported through `admit`;
- whether personal memory and the personal shelf were in play.

It grows out of `markAnswerRestrictedUse`, which already marks single answers for
restricted folders. The client-written `retrievalLedger` stays a display aid and
is never read for permissions.

## Python enforces

These rules apply to reads that shape an answer:
- With `require_auth` on, a turn without a valid signed decision reads nothing:
  no base corpus, no project, personal or restricted source.
- An empty scope stays empty. Today `if header_scope:` in
  `knowledge_layer/search/scope.py` falls through to the config path.
- `RequestContext.from_envelope` refuses an unsigned envelope when
  `INTERNAL_API_TOKEN` is unset.
- `project_context.from_context`, `from_headers` and
  `scoping._raw_collection_scope_from_header` stop falling back to plain
  `x-grid-*` headers.

Before any of this lands, local development gets a dev token and tests get a
signing helper. About 25 test files inject plain headers today.

The envelope middleware (`apps/agent-host/src/agent_host/context_envelope.py`) exempts
eight prefixes and refuses only under `require_auth`:
- `/health`
- `/v1/collections`
- `/v1/documents`
- `/v1/data_sources`
- `/v1/jobs/async/agents`
- `/v1/jobs/async/job`
- `/v1/jobs/async/jobs`
- `/v1/drafts`

These routes keep their internal-token guard, and fail-closed does not touch them.
Neither does ingestion. A job worker binds its identity (organization, project,
user) explicitly from the job it runs, not by parsing plain headers, so a run
without an envelope still names its organization for residency, credentials and
cost. Since slice 3b a job's scope comes only from its signed envelope
(`signed_job_scope` in `jobs/submit.py`). A run without one keeps its identity
(`bind_worker_identity`) but reads no scope, and is counted as
`jobs.envelope_less_runs`.

**A BFF route serving a turn** takes the turn's shelves from one helper: the
verified decision when the call carries one, the envelope's signed scope
otherwise. A socket turn's envelope carries no scope, so a route that checks only
the envelope would refuse every chat turn. That helper is `withTurnShelves`
(`bff/conversation-context/index.ts`), used by the document-file, estate-tree
and document-annotations routes since slice 3b.

## What it makes possible

Each of these is the same function resolved for another audience, or a read of
the per-answer record. None needs a rule of its own.
1. **„Gelesen“ under every answer.** It shows the places and files read, whether
   personal memory or Meine Ablage was in play, and who reads the chat.
2. **Joining later.** Someone added to a chat sees the earlier answers. A source
   they may not open shows as withheld. The `contentLocked` path in
   `bff/sharing/access.ts` is its start.
3. **A preview before sharing.** The context is resolved for the audience the
   chat would have, and the preview lists the answers that rest on sources the
   new readers may not open. The choices are „share anyway“ or „hide those“.
4. **Asking privately in a shared chat.** The asker's own context answers, only
   the asker sees it, and they decide whether the chat does. Microsoft 365
   Copilot does this in Teams group chats.
5. **Bringing a personal file into a project chat on purpose.** It becomes a
   recorded source, needs the owner's yes, and shows to everyone as attached.
6. **Moving a chat between Persönlich and a project.** It is allowed when the
   chat's record fits the target, and refused with the reason when it does not.
7. **Tasks and deep research with a stated reach** („liest: Projekt X,
   Bürobibliothek“). This includes personal tasks over Meine Ablage, which the
   table above withholds until they are designed.
8. **Why the agent knew something.** The per-answer trail is something an
   office can show.

The first two come first. They are cheap once the per-answer record exists, and
they make visible what users have had to take on trust.

## Slice 1 contract

What slice 1 fixes, so no builder has to guess:
- **The decision on the wire.** The decision is JSON signed exactly as the
  request envelope is: HMAC-SHA256 over the raw JSON with `INTERNAL_API_TOKEN`,
  as in `buildRequestContextEnvelope` and the CommonJS copy in
  `bff/turns/turn-headers.js`. It travels in `x-turn-decision` and
  `x-turn-decision-signature`.
  - **Fields:** `organizationId`, `userId` (the asker; a decision is refused for
    anyone else), `conversationId`, `answerMessageId`, `kind`, `audienceVersion`
    (number or null), `issuedAt`, `may` (without `projectMemory`, which stays in
    the BFF).
  - **Maximum age:** 30 minutes for a chat turn. A run's decision is renewed with
    its envelope.
  - **Where it goes:** Python sends it on every agent-api and internal call the
    turn makes.
- **The schema.** A zod `conversationDecisionSchema` in the module's
  `wire.ts` generates a JSON schema named conversation-decision beside the other
  fixtures in `apps/workspace/tests/fixtures/`, as
  `bff/documents/lifecycle-schema.ts` generates the lifecycle schema. A
  TypeScript spec, a spec on the CommonJS signer and a Python spec all parse the
  fixture.
- **What slice 1 moves.** The turn path: `resolveTurnContext`, the
  `retrieval-scope` builders, `turn-context/service.ts`, the agent-api audience
  reads, and `reach`. The locked writers in `restricted-use.ts` stay as they are.
  - **Guard spec:** `readConversationAudience` has a ratcheted allowlist of its 15
    call sites. Slice 1 shrinks it to the module plus the locked writers, and
    later slices may only shrink it further.
  - **The agent-api before slice 2:** it resolves the context per call, as it
    reads the audience today. Slice 2 makes it read the decision the turn sends.
- **Fail-closed.** `resolveConversationContext` never degrades: on an error the
  turn gets no personal memory, no personal shelf and no project, restricted or
  other-project source. It is never advisory.
- **Backfill.** `audience_version` needs none; rows start at 0. Answers written
  before slice 1 have no per-answer record, and „Gelesen“ shows nothing for them
  rather than guessing.
- **The trace (delivered in slice 2, where Python binds the decision).** Each turn's Langfuse trace carries `context.kind`,
  `context.solo`, `context.audienceVersion`, `context.shelves`,
  `context.personalMemory`, `context.personalShelf` and `context.features`.

## Migration order

1. **The BFF decides and dual-writes.** `turn-decision` exists, and the socket
   envelope still carries the old `collectionScope`.
2. **Python binds the decision before any scope read.** A bound decision is the
   only scope. Its signature authorizes only the scope it names; each restricted
   read still needs live admission (`admit`, under the audience lock). Where a
   decision is required (`require_auth`) and missing or refused, the turn reads
   nothing. Only where no decision is required does Python fall back to the old
   envelope scope, inside a valid signature, and a restricted collection there
   still passes the live per-turn check (`begin_restricted_use`) until step 3.
3. **The old fields are dropped (slice 3b).** That means the upgrade-time scope, the
   plain-header fallbacks and `begin_restricted_use`. The gate is a fact, not a
   clock: no run that started before step 2 was deployed is still active, and no
   queued `/v1/jobs/async` job holds an old envelope. This goes in step with the
   header rename that `legacy_headers.py` already schedules. The gate is
   checked by `scripts/conversation_context_gate.py`, following
   [the runbook](../deployment/conversation-context-gate-runbook.md).

## Slices

1. **The module, its BFF consumers, `audience_version` and the record per
   answer**, per the slice 1 contract. Builds on
   [#1899](https://github.com/archos-at/archos/pull/1899), which already takes a
   turn's project from the row.
2. **Python binds the decision and fails closed on answer-shaping reads**, under
   the generated contract. The readers that shape an answer read scope through
   `scoping` or the bound decision only: the turn's inventory,
   `knowledge_context.corpus_countries`, `turn/context.py` and the document-file
   fetch. An empty bound scope lists nothing.
3. **The old paths are dropped**, per the migration order. These scope builders
   join `kind`:
   - `jobs/run-context.ts`
   - `app/api/jobs/async/[...path]/route.ts` with `bff/jobs/request-envelope.ts`
   - `project-intake/run.ts`
   - the wake stop job
   - `backend-operations.ts`

   The remaining direct `.collection_scope` readers move onto `scoping` here:
   the run and job readers (`jobs/access.py`, `agent_job_setup.py`,
   `run_envelope.py`), `routes/document_search.py` (an exempt route),
   `routes/skills.py` and `turn/response.py`.
4. **ADR-0193 on top:** `may.personalShelf`, the personal admit callback,
   `recorded.personalShelf` and the owner's confirmation. The personal shelf's
   row policy extends the one permissive policy on `documents` (migration 0031,
   held by `rls-coverage.spec.ts`), so it is a single predicate. The builder
   names which background paths (ingestion settle, filing) must still reach
   personal rows, and how.
5. **„Gelesen“ and joining later**, the first two of what it makes possible.

Each slice changes what shapes an answer, so it runs the golden run on dev before
and after (`docs/contributing/testing-and-verification.md`).

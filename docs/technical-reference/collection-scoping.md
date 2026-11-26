# Collection Scoping

Controls which knowledge collections are searched for each knowledge retrieval request. The scope is computed in the Next.js BFF and propagated to the Python backend via an HTTP header.

---

## Purpose

When a user asks a question, the AI needs to know which knowledge sources to search. Collection scoping solves this by building an **ordered, deduplicated list of collection names** per request that includes:

- The base OIB knowledge collection (always)
- The org-wide Archiv collection (`archiv_{orgId}`, when the Archiv feature is enabled for the org — ADR-0024)
- The active project collection (`proj_{projectId}`, if working in a project)
- The restricted-folder collections the session is cleared for
  (`<project collection>_r<12 hex>`, interactive chat turns only — ADR-0087, see
  [Restricted folders](#restricted-folders-adr-0087-adr-0088-adr-0097))
- The session collection (`s_{conversationId}`, if in a conversation)

This page is about which collections a request READS. What writes into the
session collection is the session-document pipeline, not the browser:
`POST /api/session/documents/upload` stores the file as a `session` document row
and dispatches it into `s_{conversationId}`, the listing and delete go through
`/api/session/documents`, and `DELETE /api/conversations/[id]` erases the whole
collection. The `/api/v1` proxy only reads an `s_` collection
([BFF routes](../api/bff-routes.md#chat-attachments-session-documents-adr-0047-phase-2)).

The Archiv collection is injected in `buildCollectionScopeFromRequest` (which has `session.organizationId`) and passed to `computeCollectionScope` as `officeShelfCollectionName`; it rides right after the base corpus, so every project in the org retrieves across the shared Archiv with no per-project configuration.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js BFF)                   │
│                                                                  │
│  computeCollectionScope(session, context) → string[]             │
│  buildCollectionScopeHeader(scope) → base64url(json)             │
│  buildCollectionScopeFromRequest(session, context) → {scope,     │
│    headerValue, projectId, conversationId}                       │
└────┬─────────────────────────────────────────────────────────┬───┘
     │ HTTP (/api/v1, /api/jobs/async)                         │ WebSocket upgrade
     │ signed envelope (runs, jobs); no scope header            │ calls /api/auth/websocket-scope
     ▼                                                          ▼
┌────────────────────────────────────────────────────────────────┐
│                   Python Backend (runtime context)              │
│                                                                  │
│  get_collection_scope_from_context() → list[str] | None         │
│    Reads the turn's decision, or a signed envelope's scope       │
│                                                                  │
│  resolve_scoped_collections(config, session_id)                  │
│    → Falls back to config-based resolution if no signed scope    │
│                                                                  │
│  _resolve_target_collections(config, session_id) → list[str]     │
│    → Legacy: use_fixed_collection, include_base_collection,      │
│      include_session_collection, project_collections             │
└────────────────────────────────────────────────────────────────┘
```

---

## Frontend: `collection-scope.ts`

**File**: `apps/workspace/bff/retrieval-scope/collection-scope.ts`

### `computeCollectionScope(session, context)`

Builds an ordered deduplicated list of collection names:

```typescript
function computeCollectionScope(
  session: UserSession | null,
  context: ScopeContext
): string[]
```

**ScopeContext**:
- `projectId?: string` — if present, adds `proj_{projectId}`
- `conversationId?: string` — if present, adds `s_{conversationId}`
- `baseCollection?: string` — defaults to `BASE_CORPUS_COLLECTION` (`base_corpus`, `bff/retrieval-scope/collection-scope.ts`)
- `restrictedCollections?: readonly string[]` — restricted-folder collections, placed right
  after the project collection. Only `buildCollectionScopeFromRequest` passes them, and only for
  an interactive chat turn; the session-less scheduled-run path (`jobs/service.ts`) never does

### `buildCollectionScopeHeader(scope)`

Encodes the scope array into a base64url-encoded header value:

```typescript
function buildCollectionScopeHeader(scope: string[]): string
// Example output: "WyJvaWJfa25vd2xlZGdlIiwicHJval8xMjMiLCJzX2FiYyJd"
// Decodes to: ["base_corpus","proj_123","s_abc"]
```

---

## Frontend BFF: `collection-scope-request.ts`

**File**: `apps/workspace/bff/retrieval-scope/collection-scope-request.ts`

### `buildCollectionScopeFromRequest(session, context)`

The main entry point for SSE and WebSocket routes. It:

1. Resolves the project from the conversation row (ADR-0193 rule 2):
   - With a `conversationId` whose row exists, the row's `project_id` is the
     project, `null` meaning none. A request `projectId` that differs is refused
     with `ConversationProjectMismatchError` (403): a chat without a project
     never reads the project the page has open.
   - With no row yet (the first turn of a chat minted in the browser, ADR-0033),
     the request's `projectId` is taken; `createConversation` stamps the same
     one on the row.
   - With no `conversationId` (deep research, runs), the request's `projectId`.
   - With neither a conversation row nor a request project, no project. The
     stored `active_project_id` preference is no longer read.

2. Enforces project access via `requireProjectAccess(session, projectId, CHAT_PERMISSIONS)` when auth is required

3. Calls `computeCollectionScope` and `buildCollectionScopeHeader`

4. Returns `{ scope, headerValue, projectId, conversationId }`

```typescript
async function buildCollectionScopeFromRequest(
  session: UserSession | null,
  context: RequestContext
): Promise<{ scope: string[], headerValue: string, projectId?: string, conversationId?: string }>
```

---

## Restricted folders (ADR-0087, ADR-0088, ADR-0097)

A folder with its own access list that not every project member reads
(`project_folders.access_mode = 'custom'` without `everyone_reads`, migrations
0111 and 0128) restricts READING. A
document under it lives in the collection of its nearest such folder,
`<project collection>_r<12 hex of the folder id>` (`restrictedCollectionName`
in `lib/authz/folder-access-rule.ts`). Who may WRITE never moves anything:
collections key on read. Retrieval keeps the collection out of reach by leaving
it out of the scope; no Python read path needs to know.

`buildCollectionScopeFromRequest` adds a project's restricted collections, with
shelf `project`, only when ALL of these hold:

- the caller passed `interactiveChat: true`. Only the WebSocket upgrade
  (`/api/auth/websocket-scope`) does. Deep research (`/api/jobs/async/*`, whose
  context comes from `parseBodyContext`/`parseQueryContext` and cannot carry
  the flag), the `/api/v1` proxy and scheduled or commissioned runs
  (`submitAgentRun`, session-less) never get one: their reports are filed for
  the whole project;
- the session may read the folder (`effectiveFolderLevel` over the levels its
  folder roles give, ADR-0097: read from WorkOS by `heldFolderLevels` in
  `lib/authz/folder-roles.ts`, cached for `AUTHZ_CACHE_TTL_MS`; a lookup
  that fails clears nothing);
- everyone the conversation is shared with may read it too
  (`readableRestrictedCollections` in `lib/conversations/restricted-use.ts`, the same rule the agent's turn-start check `drawableRestrictedCollections` asks; the turn reads the audience once, through `lib/conversation-context`).

The same rule gates the collection proxy: `/api/v1/collections/<name>` with a
restricted name is authorized as its project's collection and then 404s unless
the session may read the folder (`lib/proxy/collection-authz.ts`).

### Per person, by what the conversation used

A conversation is restricted by what it USED, recorded per source folder in
`conversation_restricted_folders` (migration 0112): content from a folder not
every member may read entered the model's context. Being able to search a
folder is not use. Each use is ADMITTED by the BFF
(`POST /api/internal/conversations/[id]/restricted-use`) before the content
reaches the model, against the asker and everyone the conversation is shared
with, under the same advisory lock every widening of the audience takes, so a
share and an admission cannot both go through:

- at turn start the agent offers the restricted collections of its signed
  scope and gets back the ones it may draw on (`drawable`) and whether the
  conversation already recorded a folder (`recorded`). It binds the answer per
  turn (`agent.knowledge.restricted_use`), and
  `get_scoped_collections_from_context` keeps only the drawable ones, so every
  read path searches only what everyone reading the conversation may read. A
  thread shared since the socket was signed loses those collections from the
  next turn on; the socket is not closed;
- a tool round's results are admitted before the model reads them
  (`ChatAgent._tools_node` → `admit_tool_results`); a result carrying a
  refused collection is replaced by a notice;
- restricted memory served into the digest, and a subject document from a
  restricted folder, are admitted by the BFF before they are sent;
- listing is not use: restricted collections stay out of the inventory block,
  `list_files` and the document cards, so a name or a summary never reaches the
  prompt without an admission.

Sharing (`assertMayWidenConversation`, `widenConversationAudience`) allows a
new reader exactly when they may read every recorded folder NOW; a folder
opened to every member drops out, and a deleted folder's tombstone (0110) keeps
answering with the access it had. The doors that write something the whole
project reads refuse a conversation with a record
(`lib/conversations/restricted-egress.ts`); deep research and tasks stay
refused for such a conversation for now.

A socket answers for one conversation only: the signed `conversationId`.
A frame naming another is refused with `conversation_mismatch` before anything
runs (`ChatSocket._admit`), so a restricted scope cannot be pointed at a
different thread over the same socket.

## WebSocket Scope

**File**: `apps/workspace/server.js` (lines 198–258)

During WebSocket upgrade (`/websocket` path):

1. `server.js` parses `projectId` and `conversationId` from the WebSocket URL query string
2. Calls `fetchTurnContext()`, an internal HTTP GET to `http://127.0.0.1:{port}/api/auth/websocket-scope?projectId=...&conversationId=...`, memoised per cookie, project and conversation (`turnContextCache`)
3. The `websocket-scope` route resolves the session from cookies and authorizes the person, the project and the conversation through `resolveTurnContext(..., { shelves: false })`: it decides no shelves, because a chat turn takes them from its signed decision (ADR-0194)
4. `server.js` signs the turn context into the request-context envelope (`socketTurnHeaders`, no `collectionScope`) and forwards `authorization` (Bearer token) for user context; no plain scope header is sent

On 401/403, the WebSocket connection is rejected with the appropriate status code.

---

## HTTP proxy routes

There is no HTTP chat route: a chat turn runs on the WebSocket alone (ADR-0068). The HTTP proxies read `projectId` and
`conversationId` and resolve the scope through the conversation-context module with kind `run`
(`resolveConversationScope`, ADR-0194), which builds it with `buildCollectionScopeFromRequest` and never draws
a restricted folder:

- `apps/workspace/app/api/v1/[...path]/route.ts`: the generic API proxy (`scopeHeader`)
- `apps/workspace/app/api/jobs/async/[...path]/route.ts`: the async job proxy (`jobScope`, signed by
  `signJobRequestContext` in `apps/workspace/bff/jobs/request-envelope.ts`)
- `apps/workspace/bff/runs/service.ts`: a run's cancel and document hand-off (`jobControlCaller`)

---

## Python: `scoping.py`

**File**: `packages/agent/src/agent/knowledge/scoping.py`

### In a chat turn: the turn's decision (ADR-0194)

A chat turn asks the BFF for its decision before it reads any scope
(`POST /api/internal/turn-decision`, from `_run` in
`packages/agent/src/agent/core/conversation_register.py`) and binds it for the
turn (`packages/agent/src/agent/common/turn_decision.py`). While a turn is bound:

- the scope is the decision's `may.shelves`, and the socket's scope is not read;
- an empty decision stays empty: neither `scoping.py` nor
  `knowledge_layer/search/scope.py` falls back to the config path;
- without a decision the turn falls back to the socket envelope's scope only when
  the envelope is signed and `INTERNAL_API_TOKEN` is set; with `REQUIRE_AUTH`
  on it reads nothing otherwise;
- the decision travels on every BFF call of the turn (`x-turn-decision`,
  `x-turn-decision-signature`, added in `bff_http.send`), and the agent-api
  narrows the audience by it: a chat shared since the turn was decided reads as
  shared, one decided shared stays shared;
- the restricted collections the turn may draw on are the decision's, so the
  restricted-use pre-check no longer runs beside it; `admit` still reports what a
  tool read.

Outside a chat turn (runs, intake, external calls) no decision is bound: the
reads below take the signed envelope, whose scope the BFF decided with the
caller's kind (`contextKind`: `run`, `headless`, `external`).

### `get_collection_scope_from_context()`

Returns the collection names of `get_scoped_collections_from_context()`: in a
bound turn the decision's shelves (nothing without a decision); outside one the
signed envelope's scope (`RequestContext.from_context` reads only a signed
envelope), or `None` when there is none. A reader of another request's scope
(job access, run renewal, document search) takes it through
`signed_scope_names(context)`. No plain scope header is read.

When the answer is `None`, `knowledge_layer/search/scope.py`
(`resolve_scoped_collections`) and the inventory fall back to the legacy
config path below; an empty signed scope stays empty.

---

## Python Legacy: `_resolve_target_collections()`

**File**: `packages/knowledge-layer/src/knowledge_layer/register.py` (line 220)

Config-based collection resolution when no signed scope is present:

```python
def _resolve_target_collections(
    config: KnowledgeRetrievalConfig,
    session_id: str | None,
) -> list[str]:
```

Layers (in order):
1. **Base collection** — `config.collection_name` if `config.include_base_collection` is True
2. **Session collection** — `session_id` if `config.include_session_collection` is True (default: True)
3. **Project collections** — `config.project_collections` (list of additional named collections)

If `config.use_fixed_collection` is True, only the base `collection_name` is returned (legacy pinned behavior).

If all layers are empty, it falls back to `[config.collection_name]`.

---

## Upper Bound: `MAX_SCOPE_COLLECTIONS`

The maximum number of collections that can be searched per request is defined in `register.py` via `MAX_SCOPE_COLLECTIONS` (currently **5**).

This limit is relevant in multi-tenant or multi-project setups where many collections could theoretically be in scope. The scope is truncated to this upper bound.

---

## Async jobs

A job's scope is its signed request-context envelope's (ADR-0194). The job
payload carries none; `signed_job_scope` in
`apps/agent-host/src/agent_host/jobs/submit.py` derives the project collection
the job's access is keyed by from it. A deep-research job without an envelope
logs a WARNING and reads the legacy config path below.

---

## Summary of Scope Resolution Priority

| Priority | Source | When |
|----------|--------|------|
| 0 (highest) | the turn's decision | A chat turn, once `turn-decision` answered |
| 1 | the signed request-context envelope's `collectionScope` | A run, job or external call; never a plain header |
| 2 | `_resolve_target_collections()` config | No decision and no signed envelope (legacy/fallback) |

A chat turn's socket envelope signs no scope; the turn reads its decision.

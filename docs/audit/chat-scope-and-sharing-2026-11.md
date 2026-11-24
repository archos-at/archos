# What a chat reads, and who reads the chat, November 2026

A survey of `develop` at `d109b5fb0` (2026-11-24), made before building a
person's own shelf („Meine Ablage“). It answers two questions: which sources
a chat's answer may draw on, and what changes when more than one person reads
the chat. The decision it led to is
[ADR-0191](../adr/0191-a-person-s-own-shelf-is-drawn-on-only-where-its-owner-alone-reads.md).

## How it was made, and how far to trust it

Two read-only agents traced the code, one for retrieval scope and memory, one
for sharing. **A row marked "read" was re-checked in the code by the author of
this page; an unmarked row is an agent's report and is a lead, not a finding.**
Paths are relative to `apps/workspace/` unless they start with `docs/` or
`packages/`.

## Where a chat's sources come from

| Fact | Where | |
|---|---|---|
| A conversation has a nullable `project_id`, a `visibility` (`private` or `project` for chats), `created_by`, `engagement` and `temporary`. A chat without a project has no name in the UI; the code calls it unstamped or `withoutContainer` | `bff/db/schema/conversations.ts`; `bff/conversations/repository.ts` — `visibleConversationsWhere` | |
| A chat cannot move into a project: `project_id` is set at insert only, and the update schema takes `title`, `engagement`, `temporary` | `bff/conversations/service.ts` — `createConversation`; `conversation-wire.ts` | |
| A turn searches a fixed set: the base corpus, the office shelf („Bürobibliothek“, always), the project's collection and the restricted folders cleared for the audience (only with a project), and the chat's own collection `s_<conversationId>` for its attachments | `bff/retrieval-scope/collection-scope.ts` — `computeCollectionScope`; the agent reads it in `packages/agent/src/agent/knowledge/scoping.py` | |
| **The project a turn searches comes from the browser, not from the conversation row.** The client sends `?projectId=`, taken from the chat's `projectId` or, when it has none, from the project the page has open. The server checks the caller may read that project but never compares it with `conversations.project_id`. A chat without a project, continued while a project page is open, searches that project | `ui/features/chat/hooks/use-websocket-chat.ts:253` — `projectIdOf`; `bff/turns/turn-context.ts` — `resolveTurnContext` | read |
| With no project passed, the scope falls back to `user_preferences.active_project_id`. No app code writes that key any more; it would widen the scope if it were ever set | `bff/retrieval-scope/collection-scope-request.ts` — `resolveActiveProjectId` | read |
| Document scopes are `project`, `office_shelf`, `session`. A chat attachment is `session`: no project even in a project chat (a CHECK holds it), access follows the chat. There is no personal scope | `bff/db/schema/documents.ts` — `DOCUMENT_SCOPES`; `bff/session-documents/service.ts` | |
| A shelf is a project or the office shelf, and the upload pipeline, listing, folders, filing and collection naming are all written against that type | `bff/documents/shelf.ts` — `DocumentShelf`; `shelf-collection.ts`; `shelf-upload.ts` | read |
| The UI names a chat attachment two ways: „Beilage in diesem Chat“ and „Private Sitzung“ | `i18n/dictionaries/de/chat.ts` | |

## Memory

| Fact | Where | |
|---|---|---|
| Personal memory is its own table keyed to `(organization_id, user_id)`, with per-user row-level security. It reaches a turn only where the asker alone reads the chat, with or without a project, and fails closed when the audience cannot be read | `bff/db/schema/personal-memory.ts`; `bff/turn-context/service.ts` — `loadPersonalMemory`; [ADR-0180](../adr/0180-personal-memory-is-its-own-table-keyed-to-the-person.md) rule 4 | |
| Project memory and office memory share `project_memory` (`scope` `project` or `organization`); office memory reaches every chat | `bff/projects/memory-recall-digest.ts` — `buildProjectMemoryDigest` | |
| Row-level security isolates by organization only for `conversations`, `documents` and `project_memory`; a private chat and its attachments are held apart from colleagues in the app layer alone. Per-user policies exist only on `user_preferences` and `personal_memory` | `migrations/0031_row_level_security.sql`, migration 0229 | |

## Who reads the chat

| Fact | Where | |
|---|---|---|
| A chat is shared by `visibility = 'project'` or by named grants in `resource_shares`; there is no participants table. Several people post into one chat, each message carries `authorUserId`, and the whole history goes to the agent whoever wrote it | `bff/sharing/registry.ts`, `bff/sharing/access.ts` — `resolveResourceAccess`; `bff/db/schema/messages.ts` | |
| The turn runs as the person posting. „The asker alone reads it“ is `isSoloAudience`: private, created by the asker, every grantee is the asker | `bff/conversations/cross-project-use.ts` — `isSoloAudience` | read |
| In a shared chat the agent reads only a document or a project's facts, and only what every reader may read; a restricted folder or a cross-project source a chat drew on is recorded (`conversation_restricted_folders`, `conversation_source_projects`), and widening the audience is refused while the record is not covered | `bff/agent-api/conversation-audience.ts` — `judgeWorkspaceRead`; `bff/conversations/restricted-use.ts` — `assertMayWidenConversation` | read |
| Every chat gets its server row with its first message (`conversation-persistence.ts`); ADR-0033 decides only which copy is the truth: the browser's for a private chat, the server's once it is shared | ADR-0033; `ui/features/chat/hooks/use-shared-thread.ts` | read |

## What is flaky, and why

1. **The project scope is the client's word** (above). The cure is the server
   deriving it from the conversation row. Any personal source makes this a
   privacy question, not a correctness one.
2. **Sharing after the fact is not covered for personal context.** Personal
   memory reaches answers while a chat is solo; nothing records that, so sharing
   the chat later shows those answers, and they become history for the next
   person's turns. Folders and projects have this record; personal memory has none.
3. **The prompt misdescribes shared chats.** `bff/turn-context/workspace-block.ts`
   tells the agent no workspace read runs in a shared chat, while
   `judgeWorkspaceRead` allows document and project-facts reads (read).
4. **Two definitions of shared.** `isShared` (visibility or any grant) drives the
   UI; `isSoloAudience` (also the creator must be the asker) drives the agent.
   They differ for a colleague who reaches a private chat without a grant.
5. **The local-first to server seam.** A chat changes which copy is the truth the
   moment it is shared, and the client's shared state can be `unknown` meanwhile.
6. **Stale status.** ADR-0180 is `proposed` though merged;
   `docs/design/collaboration-sharing-and-inbox-spec.md` says „Proposed“ while its
   §15 says implemented; the dictionary still carries `organization` visibility
   strings that phase 1 withholds.
7. **Every human message is context.** With two or more authors the agent only
   suggests switching to „on mention“, so it may answer a message meant for a
   colleague.

8. **The audience is decided many times.** `readConversationAudience` has
   fifteen call sites in the BFF (read), and one turn reads the row at least eight
   times across scope, restricted use, turn context, memory digest, workspace
   reads and reach; solo or shared is decided at five points.
9. **The scope cache ignores the audience.** `server.js` caches a turn's scope
   for 10 seconds keyed on cookie, project and conversation (`scopeCacheKey`,
   read); sharing a chat inside that window serves the old scope.
10. **Runs build their scope apart.** `bff/jobs/run-context.ts` calls
    `computeCollectionScope(null, {projectId, …})` (read): no office shelf, no
    audience, no restricted folders.
11. **The Python side allows more when context is missing** (read). With
    `INTERNAL_API_TOKEN` unset, `RequestContext.from_envelope` accepts an unsigned
    envelope; without a valid envelope, `from_context` falls back to the plain
    `x-grid-*` headers and `scoping.py` to the raw scope header; an empty scope
    falls through `if header_scope:` in `knowledge_layer/search/scope.py` to the
    config path; `stages/flags.py` treats an unreachable BFF as „allowed“. Not an
    open door today: `server.js` strips client context headers, the agent host
    refuses requests without a valid envelope, and the config path holds only the
    base corpus and the chat's own collection. It is a missing second line.

Items 1 and 2 are taken up by ADR-0191, items 1, 2, 3, 4, 8, 9, 10 and 11 by
[ADR-0192](../adr/0192-a-conversation-s-context-is-decided-once-in-the-bff-and-enforced-everywhere.md).
Items 5 to 7 are open.

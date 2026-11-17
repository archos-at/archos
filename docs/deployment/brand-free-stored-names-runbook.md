<!-- drop after release 2026-W50: the contract step of ADR-0182 phase 4 deletes this runbook with the legacy modules -->

# Stored names without the brand: deploy 2 and the contract

ADR-0182 phase 4 moves six stored names in three deploys. **Deploy 1** (expand)
ships the new spelling beside the old: readers accept both, writers keep the old.
This runbook is **deploy 2** (backfill, then switch the writers) and the
**contract** (drop the old spelling). Every backfill below needs the owner's yes
before it runs, and runs only after deploy 1 is live on every tier: the BFF, the
UI, the agent host, the agent workers and the purger.

Order for each name: owner's yes → dry run → backfill → writer switch (a
release) → sweep (the backfill again, for rows old pods wrote during the
rollout) → contract (a later release, after the owner confirms the switch ran).
Run SQL as the database owner. The runtime role is confined by tenant RLS and
would see one organization.

## 1. Session settings `grid.organization_id`, `grid.user_id` → `app.*`

- **Deploy 1:** migration 0241. `current_org()` and `current_user_id()` read
  `app.*` first, then `grid.*`, and so do the four `organization_id` column
  defaults. The BFF's `contextStatement` (`bff/db/index.ts`) sets both names.
- **Backfill:** none. No row stores the setting.
- **Switch:** a migration redefines both functions and the four defaults to read
  `app.*` only. Its down file restores 0241, never 0031. `contextStatement`, the
  drizzle defaults in `schema/messages.ts` and `schema/conversation-reads.ts`, and
  `scripts/rls-test-db.sh` move to `app.*` in the same change.
- **Contract:** delete `bff/db/legacy-tenant-settings.ts`.

## 2. Actor kind `'piloti'` → `'agent'`

- **Deploy 1:** migration 0242. The checks on `document_annotations.author_kind`,
  `document_annotation_replies.author_kind` and `proposed_changes.proposed_by_kind`
  accept both values, under brand-free constraint names. `isAgentKind` /
  `is_agent_kind` answer either value.
- **Before the backfill:** re-grep every serializer to an outside MCP or A2A
  client. None sends `authorKind` or `proposedByKind` today; one that does must
  map `'agent'` back first.
- **Backfill**, in batches until each returns 0 rows:

  ```sql
  UPDATE document_annotations SET author_kind = 'agent'
   WHERE id IN (SELECT id FROM document_annotations WHERE author_kind = 'piloti' LIMIT 1000);
  UPDATE document_annotation_replies SET author_kind = 'agent'
   WHERE id IN (SELECT id FROM document_annotation_replies WHERE author_kind = 'piloti' LIMIT 1000);
  UPDATE proposed_changes SET proposed_by_kind = 'agent'
   WHERE id IN (SELECT id FROM proposed_changes WHERE proposed_by_kind = 'piloti' LIMIT 1000);
  ```

- **Switch:** every write-side `LEGACY_AGENT_KIND` becomes `AGENT_KIND`
  (`bff/annotations/service.ts`, `agent-work.ts`, `wake-job.ts`, `wake-audit.ts`,
  `bff/proposals/service.ts`, `bff/realtime/document-channel.ts`,
  `bff/agent-api/principal.ts`). Python writes no actor kind.
- **Contract:** a migration drops `'piloti'` from the three checks. Delete the legacy modules.
- **Owner decision:** audit rows with `by = 'piloti'` are history and are not rewritten.

## 3. Inbox and audit types `piloti.*` → `agent.*`

- **Deploy 1:** no DDL; `inbox_items.type` is plain text. Readers map an old
  type to the new one (`bff/inbox/legacy-agent-types.ts`). Writers keep the old
  type and group key.
- **Backfill:** a type and its group key move together, because the unique index
  `(recipient_user_id, group_key)` dedupes on the key. First check that no twin
  exists:

  ```sql
  SELECT count(*) FROM inbox_items p JOIN inbox_items a
    ON a.recipient_user_id = p.recipient_user_id AND a.group_key = 'agent.' || substr(p.group_key, 8)
   WHERE p.type LIKE 'piloti.%';   -- must be 0; otherwise merge each twin's count, then delete the old row
  UPDATE inbox_items SET type = 'agent.' || substr(type, 8), group_key = 'agent.' || substr(group_key, 8)
   WHERE type IN ('piloti.work_done', 'piloti.work_failed', 'piloti.asks_you',
                  'piloti.proposal_waiting', 'piloti.intake_ready', 'piloti.revision_checked');
  ```

- **Switch:** `storedInboxType` (`bff/inbox/legacy-agent-types.ts`) returns its argument.
- **Audit actions:** WorkOS audit events are immutable and keep their names. The
  writer switch is `writtenAuditAction` (`bff/audit/legacy-agent-actions.ts`), and
  it needs the `agent.*` schemas provisioned in WorkOS first (the deploy's authz
  Job reconciles them). Whether audit names move at all is the owner's call. A
  release note says the audit log shows both names.

## 4. Mention id `agent:piloti` → `agent:core`, project setup `'piloti'` → `'agent'`

- **Deploy 1:** no DDL. Readers resolve either id (`bff/mentions/legacy-mention-ids.ts`)
  and either setup value (`bff/projects/legacy-project-setup.ts`).
- **Backfill of the mention id**, in four stores: `document_annotations.mentions`,
  `document_annotation_replies.mentions`, `inbox_items.payload->'mentions'` and
  `messages.metadata->'mentions'`. For each, rewrite the `targetId` of the
  matching elements:

  ```sql
  UPDATE document_annotations AS a SET mentions = (
    SELECT coalesce(jsonb_agg(CASE WHEN m.value->>'targetId' = 'agent:piloti'
             THEN jsonb_set(m.value, '{targetId}', '"agent:core"') ELSE m.value END ORDER BY m.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(a.mentions) WITH ORDINALITY AS m(value, ordinality))
   WHERE a.mentions::text LIKE '%agent:piloti%';
  ```

  A mention inside free text is not rewritten; readers keep accepting it.
- **Project setup:** no project row stores the value, so there is nothing to backfill.
- **Switch:** `bff/mentions/service.ts`, `ui/features/documents/components/review/composer.tsx`
  and the chat composer write `agent:core`.
- **Contract:** delete both legacy modules, and remove `'piloti'` from `PROJECT_SETUPS`
  and the published OpenAPI enum.

## 5. Document namespace `piloti/` → `generated/`

The namespace is the join key between a document row and its vectors, and the
purge deletes by it. Postgres and Qdrant must move together.

- **Deploy 1:** migration 0243. The live-name index covers both prefixes. Every
  reader treats either prefix as agent-written (`AGENT_DOCUMENT_NAMESPACES`,
  `bff/documents/legacy-agent-namespace.ts`, `common/legacy_document_namespace.py`).
- **Before the backfill:** widen the backend purge (`vector_store/store.py`
  `delete_file`) to delete both spellings of a name.
- **Dry run:** count `documents.filename LIKE 'piloti/%'` (N) and `LIKE 'generated/%'`
  (must be 0). Count `filename`, `superseded_by`, `revision_suggestion` and
  `change_basis` in `document_metadata` and `document_revision_retained`. Check
  `max(length(filename))` against those columns' 512 limit, since the new prefix
  is three characters longer. In each Qdrant collection, count `file_name`
  values starting `piloti/` per name.
- **Backfill A** (Postgres, one transaction):
  `UPDATE … SET <col> = regexp_replace(<col>, '^piloti/', 'generated/') WHERE <col> LIKE 'piloti/%'`
  for `documents.filename` and the four columns of each metadata table.
- **Backfill B** (Qdrant, after A commits): per collection, set `file_name` to the
  new name on every point whose `file_name` equals an old one (`set_file_payloads`).
- **Verify:** no `piloti/` left in either store, and the counts equal the dry run's.
- **Switch:** `agentDocumentFilename` writes `generated/`.
- **Rollback:** reverse in the opposite order.

## 6. Qdrant payload `grid_document_id` → `document_id`, lane `office_piloti` → `office_agent`

- **Deploy 1:** every point written gets `document_id` beside `grid_document_id`,
  with one value and its keyword index. Readers still filter on the old key. The
  lane is read under both values, and its one writer
  (`norm_registry.lane_for_knowledge_hit`) still writes the old one.
- **Before the backfill:** in each collection, count points that already carry a
  `document_id`. It must be 0, or those points hold an older meaning.
- **Backfill:** per collection, scroll the points with `grid_document_id` and no
  `document_id` (500 per page, no vectors) and `set_payload` the new key from the
  old. Repeat until none are left. Then check that a sample of 1,000 ids has
  equal values.
- **Switch:** readers filter on `document_id` (`vector_store/similar.py`,
  `search/document_groups.py`, the agent host's `document_search` and
  `similar_passages`). Writers keep both keys until the contract. The lane writer
  writes `office_agent`.
- **Lane backfill:** the lane is stored in Postgres (`messages.metadata` citation
  sources, `citation_events.detail.lanes`). A 0163-shaped migration replaces
  `office_piloti` on those paths only.
- **Contract:** stop writing `grid_document_id`, drop its index, run a batched
  `delete_payload` of it, and delete the legacy modules.

## Exempt, not moved

The Qdrant alias names `piloti_corpus` and `piloti_office`, the S3 buckets and the
Pulumi stack stay as they are (ADR-0182 decision 4).

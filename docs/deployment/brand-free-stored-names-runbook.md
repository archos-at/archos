<!-- drop after release 2026-W50: the contract step of ADR-0182 phase 4 deletes this runbook with the legacy modules -->

# Stored names without the brand: deploy 2 and the contract

ADR-0182 phase 4 moves six stored names in three deploys. **Deploy 1** (expand,
#1758) ships the new spelling beside the old: readers accept both, writers keep
the old. This runbook is **deploy 2** (switch the writers, then backfill) and the
**contract** (drop the old spelling).

Deploy 2 ships in three steps, one pull request each, in this order:

1. **Writers switch** for sections 1 to 4 and the lane of section 6, with their
   backfill scripts.
2. **Qdrant `document_id`** (section 6): backfill it, filter on it, and purge by
   it instead of by `file_name`.
3. **Namespace `piloti/` → `generated/`** (section 5), once nothing joins or
   purges on `file_name`, and once "agent-written" is read from the actor kind,
   not from the prefix.

A step merges only after prod runs the release before it. One promotion that
carries an expand and its switch would let the migrate Job switch the database
while old pods still write the old spelling.

Every backfill run, on dev or prod, needs the owner's yes. Order for each name:
writer switch live on every tier (BFF, UI, agent host, workers, purger) → dry
run → backfill → dry run again (every count 0) → contract (a later release).
Run SQL as the database owner, outside a transaction: the runtime role is
confined by tenant RLS and would see one organization, and each batch commits.

The step-1 scripts are in `apps/workspace/scripts/brand-free-backfill/`. Every
script is idempotent, and `scripts/rls-test-db.sh` runs each against the full
schema.

```bash
psql "$OWNER_URL" -f apps/workspace/scripts/brand-free-backfill/dry-run.sql
psql "$OWNER_URL" -f apps/workspace/scripts/brand-free-backfill/<name>.sql
```

| Environment | Dry run before | Backfill run | Dry run after |
|---|---|---|---|
| dev | not run | not run | not run |
| prod | not run | not run | not run |

## 1. Session settings `grid.organization_id`, `grid.user_id` → `app.*`

- **Deploy 1:** migration 0241. `current_org()` and `current_user_id()` read
  `app.*` first, then `grid.*`, and so do the four `organization_id` column
  defaults. The BFF set both names.
- **Switch (step 1):** migration 0245 reads `app.*` only, and its down file
  restores 0241. `contextStatement` (`bff/db/index.ts`) and the drizzle defaults
  set and read `app.*` only, and `bff/db/legacy-tenant-settings.ts` is gone.
- **Backfill:** none. No row stores the setting.
- **Contract:** done with the switch.

## 2. Actor kind `'piloti'` → `'agent'`

- **Deploy 1:** migration 0242. The checks on `document_annotations.author_kind`,
  `document_annotation_replies.author_kind` and `proposed_changes.proposed_by_kind`
  accept both values, under brand-free constraint names. `isAgentKind` /
  `is_agent_kind` answer either value.
- **Switch (step 1):** every writer writes `AGENT_KIND`. The agent's room peer is
  `agent-<conversation>`, and the wake audit's `by` is `'agent'`.
- **Backfill:** `actor-kind.sql`, three batched `UPDATE`s. No serializer to an
  outside MCP or A2A client sends `authorKind` or `proposedByKind`.
- **Contract:** a migration drops `'piloti'` from the three checks. Delete the legacy modules.
- **Owner decision:** audit rows with `by = 'piloti'` are history and are not rewritten.

## 3. Inbox and audit types `piloti.*` → `agent.*`

- **Deploy 1:** readers map an old inbox type to the new one
  (`bff/inbox/legacy-agent-types.ts`). The `agent.*` audit schemas were
  provisioned in WorkOS by deploy 1's `grid-app-audit-schemas` Job.
- **Switch (step 1):** inbox rows and their group keys are written under the
  `agent.*` type. Audit events are sent under their `agent.*` action.
  The `piloti.*` actions join `RETIRED_AUDIT_ACTIONS`: their schemas stay
  registered so the history reads.
- **Backfill:** `inbox-types.sql`. A switched pod writes an `agent.*` row for a
  resource whose `piloti.*` row is still open, so the script first folds each old
  row into its twin (the counts add up, the earlier `created_at` stays), then
  renames the rest. Until it runs, a person can see an item twice, and an old
  item is not resolved by its group key: run it right after the switch is live.
- **Owner decision:** WorkOS audit events are immutable, and past `piloti.*`
  events stay as they are. A release note says the audit log shows both names.
- **Contract:** delete `bff/inbox/legacy-agent-types.ts`. The `piloti.*` audit
  schemas stay retired until no event under them is left in the retention window.

## 4. Mention id `agent:piloti` → `agent:core`, project setup `'piloti'` → `'agent'`

- **Deploy 1:** readers resolve either id (`bff/mentions/legacy-mention-ids.ts`)
  and either setup value (`bff/projects/legacy-project-setup.ts`).
- **Switch (step 1):** the mention service, the review composer and the chat
  composer write `agent:core`. The project form sends `'agent'`, the schema
  defaults to it, and the `project.created` audit event records it.
- **Backfill:** `mention-ids.sql` rewrites each `"targetId": "agent:piloti"` in
  `document_annotations.mentions`, `document_annotation_replies.mentions`,
  `inbox_items.payload` and `messages.metadata`. A mention inside free text is
  not rewritten; readers keep accepting it. No project row stores the setup.
- **Contract:** delete both legacy modules, and remove `'piloti'` from `PROJECT_SETUPS`
  and the published OpenAPI enum.

## 5. Document namespace `piloti/` → `generated/`

Today the namespace is the join key between a document row and its vectors,
the purge deletes by it, and readers take the prefix to mean "agent-written".
Step 3 starts only after step 2 has moved the join and the purge to
`document_id`. Step 3 also moves each prefix check to the actor kind, or to a
column that says who wrote the document, so the prefix means nothing afterwards.

- **Deploy 1:** migration 0243. The live-name index covers both prefixes. Every
  reader treats either prefix as agent-written (`AGENT_DOCUMENT_NAMESPACES`,
  `bff/documents/legacy-agent-namespace.ts`, `common/legacy_document_namespace.py`).
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
  lane is read under both values.
- **Lane switch (step 1):** `norm_registry.lane_for_hit` writes `office_agent`.
  `lanes.sql` rewrites `office_piloti` as a value in `messages.metadata`, and as
  a key of `citation_events.detail.lanes`, where its count adds to an existing
  `office_agent` count.
- **Before the backfill:** in each collection, count points that already carry a
  `document_id`. It must be 0, or those points hold an older meaning.
- **Backfill:** per collection, scroll the points with `grid_document_id` and no
  `document_id` (500 per page, no vectors) and `set_payload` the new key from the
  old. Repeat until none are left. Then check that a sample of 1,000 ids has
  equal values.
- **Switch:** readers filter on `document_id` (`vector_store/similar.py`,
  `search/document_groups.py`, the agent host's `document_search` and
  `similar_passages`). Writers keep both keys until the contract.
- **Purge (step 2):** `vector_store/store.py` `delete_file` deletes by
  `document_id`, not by `file_name`, so the namespace no longer keys the purge.
- **Contract:** stop writing `grid_document_id`, drop its index, run a batched
  `delete_payload` of it, and delete the legacy modules.

## Exempt, not moved

The Qdrant alias names `piloti_corpus` and `piloti_office`, the S3 buckets and the
Pulumi stack stay as they are (ADR-0182 decision 4).

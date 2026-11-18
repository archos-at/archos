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

| Step | Environment | Dry run before | Backfill run | Dry run after |
|---|---|---|---|---|
| 1 (SQL) | dev | actor kind 21 / 2 / 21; inbox 44, twins 0; mention id 0 / 2 / 0 / 0; lane 36 / 6 | 2026-11-18 ~13:45 UTC, after #1761 was live on every dev workload: all four scripts; `inbox-types.sql` renamed 44, a second run 0 | every count 0 |
| 1 (SQL) | prod | actor kind 59 / 2 / 117; inbox 185, twins 0; mention id 0 / 2 / 0 / 0; lane 0 / 0 | 2026-11-18 ~15:47 UTC, after the promotion with #1761 (#1781) was live on every prod workload: all four scripts; `inbox-types.sql` renamed 185, a second run 0 | every count 0 |
| 2a (Qdrant) | dev | office collections 192 with only the old key, 0 disagree; base corpus 0 | 2026-11-18 13:35 UTC: 192 written | 0 left, 0 disagree; a second dry run 0 |
| 2a (Qdrant) | prod | office collections 108,864 with only the old key, 0 disagree; base corpus 0 | 2026-11-18 13:56–13:59 UTC, before #1765 reached prod: 108,864 written | 0 left, 0 disagree; a second dry run 0 |

The step-1 counts follow `dry-run.sql`'s rows: actor kind is annotations /
replies / proposals, mention id is annotations / replies / inbox payloads /
messages, and lane is messages / citation events.

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

The namespace was the join key between a document row and its vectors, the
purge deleted by it, and readers took the prefix to mean "agent-written". Step 2
moved the join and the purge to `document_id`. Step 3 moves the last readers to
the producer, so the prefix means nothing, and then renames it.

- **Deploy 1:** migration 0243. The live-name index covers both prefixes.
- **Data check** (2026-11-18, read-only): every row under `piloti/` is an
  `agent_document`, and every `agent_document` is under `piloti/`. Prod: 6 rows,
  none published, longest name 118. Dev: 8 rows, 2 published, longest name 107.
  No row under `generated/`. `document_metadata`, `document_revision_retained`
  (in the `jobs` database) and Qdrant hold no `piloti/` name on either.
- **Switch (step 3):** "may be indexed" is `authored_by_producer = 'agent_document'`
  (`isNamespacedAgentDocument`, `bff/documents/agent-namespace.ts`) in
  `collectionFileRef`, publishing, re-dispatch and the permits lookup. Migration
  0246 moves the live-name index to the same test; its down file restores 0243.
  `agentDocumentFilename` writes `generated/`. Python's `estate_paths` strips
  either prefix until the contract.
- **Dry run:** `namespace-dry-run.sql` on the app database: rows of
  `agent_document` under `piloti/`, rows of any other producer under `piloti/`
  (must be 0), rows under `generated/`, and `permit_records` and
  `document_quarantine_decisions` names under `piloti/`.
- **Backfill A**, after the switch is live, as the owner, one transaction each:
  `namespace.sql` on the app database (`documents`, `permit_records`,
  `document_quarantine_decisions`), then `namespace-metadata.sql` on the `jobs`
  database (the key, `superseded_by` and the names inside `revision_suggestion`
  of both metadata tables). Both are idempotent.
- **Qdrant:** run the read-only step-3 Qdrant check. A point still under a
  `piloti/` name belongs to a published document that was indexed before the
  rename: re-index that document, which writes its passages under the new name
  and deletes the old ones by `document_id`. Do this before the weekly vector
  reconcile sweep, which deletes passages whose name no row carries.
- **Verify:** the dry run shows 0 everywhere except `generated/`, and the Qdrant
  check shows no `piloti/` point.
- **Rollback:** before backfill A, revert the release. After it, rename back with
  the same scripts, prefixes swapped, then revert.

| Step | Environment | Dry run before | Backfill run | Dry run after |
|---|---|---|---|---|
| 3 (namespace) | dev | 8 `agent_document` rows under `piloti/`, 0 else | not run | not run |
| 3 (namespace) | prod | 6 `agent_document` rows under `piloti/`, 0 else | not run | not run |

## 6. Qdrant payload `grid_document_id` → `document_id`, lane `office_piloti` → `office_agent`

- **Deploy 1:** every point written gets `document_id` beside `grid_document_id`,
  with one value and its keyword index. Readers still filter on the old key. The
  lane is read under both values.
- **Lane switch (step 1):** `norm_registry.lane_for_hit` writes `office_agent`.
  `lanes.sql` rewrites `office_piloti` as a value in `messages.metadata`, and as
  a key of `citation_events.detail.lanes`, where its count adds to an existing
  `office_agent` count.
- **Backfill (step 2a):** `scripts/qdrant_backfill_document_id.py`, run in a
  pod that has `QDRANT_URL` and `QDRANT_API_KEY` (every agent-host pod), after
  deploy 1 is live everywhere. The dry run (`all`) counts, per collection, the
  points with only the old key, and the points whose two keys disagree, which
  must be 0. `all --apply` gives each point with only the old key the new one,
  500 per page with no vectors, and exits 1 while any is left or any pair
  disagrees. Points with neither key (the base corpus, law lookups, imports)
  are not touched.
- **Switch (step 2b):** readers filter on and read `document_id`
  (`vector_store/similar.py`, `search/document_groups.py`, the agent host's
  `document_search` and `similar_passages`), and a hit's metadata carries
  `document_id` instead of the old key. The search response sends the id under
  both names; the BFF reads `document_id` first
  (`bff/documents/legacy-search-hit.ts`). Writers keep both keys until the
  contract. Merge 2b only after 2a has run on that environment: until then, a
  reader that filters on `document_id` misses the points that lack it.
- **Purge (step 2b):** the BFF sends `documents: [{id, file_name}]` beside
  `file_ids` (`chunkPurgeBody`). A backend that reads `documents` deletes the
  points whose `document_id` is the id, and the points stored under the name
  that carry no `document_id` (an import, a point from before the field), never
  another document's. The job records and summaries are forgotten for every name
  a deleted point was stored under. A backend one release old reads `file_ids`.
  The base corpus, law lookups and the vector reconcile sweep still delete by
  name: their points have no document row.
- **Follow-up, not in this phase (owner decision):** `document_metadata` and
  `document_revision_retained` are keyed by `(collection, filename)`, and so are
  the listing, the tags, title and folder-path routes, the facets and the BFF's
  search joins. After step 2 the purge no longer depends on the name, but the
  summaries and metadata still join on it. Re-keying them by `document_id` is
  its own project; until then step 3 rewrites the namespace in Postgres,
  `document_metadata`, `document_revision_retained` and Qdrant together.
- **Contract:** stop writing `grid_document_id`, drop its index, run a batched
  `delete_payload` of it, and delete the legacy modules.

## Exempt, not moved

The Qdrant alias names `piloti_corpus` and `piloti_office`, the S3 buckets and the
Pulumi stack stay as they are (ADR-0182 decision 4).

# Production release, November 2026: develop to prod

The runbook for taking develop to prod after the 2026-10-28 promotion. It is a
one-off: it orders the steps that the area runbooks
([hatchet.md](hatchet.md), [project-mail-runbook.md](project-mail-runbook.md),
[rollover-to-prod.md](../design/international/rollover-to-prod.md),
[cd.md](cd.md), [rollback.md](rollback.md)) each describe for their own part,
and adds what none of them covers because it only shows when all of it lands
at once.

Read at `origin/develop` `cfc79f264` and `origin/prod` `f48bdcc4c` on
2026-11-12 (first written at `0a5cb0a6f`; the 42 commits since add no
migration and no prod config, and are folded in below). Prod runs `sha-331b9d9117661b201c762a7017f9c0d17ec21866` (content
of develop `8cb6cf646`), migrations through `0191`. Nothing in this document was
run against prod. Statements marked **unverified** come from reading code, not
from the cluster, ESC or WorkOS.

## What is in the jump

- 248 squashed PRs (430 commits), 44 migrations (`0192` to `0235`).
- **Background work moves to Hatchet** (ADR-0150): a new namespace with a
  RabbitMQ cluster, a second CNPG cluster and the Hatchet engine. The scheduler
  Deployment goes. There is no switch and no image-only way back.
- **Building law becomes country records** (ADR-0175): from `f2bf338cb` (#1578)
  on there is no switch either. Until Austria is published on prod, every
  Austrian turn runs on gate `none`.
- **Project mail** (ADR-0137/0138): code and tables only. The Pulumi lines stay
  commented; it goes live in three later promotions.
- Everything customers will notice:
  [the release overview](https://claude.ai/artifact/L9oDbiemnvaynkT39eZHe9)
  (private artifact; ask the owner).

## The decision: two promotions instead of one

The two one-way doors in this jump are independent of each other: Hatchet
(infrastructure, no image rollback) and the law cut-over (a degraded window
that only a second person's review on prod closes). Taking both in one deploy
means that when something breaks, nobody knows which one it was, and the
rollback of one undoes the other.

develop has a commit that separates them. `b3fa243d73adb06832487b4bd3e18063aadb6658`
(#1583, 2026-11-10) is the parent of the cut-over `f2bf338cb`. In it, the knowledge
context, the building-law chain, time editions and platform and office base
knowledge are still behind the WorkOS flags `knowledge-context`,
`building-law-chain`, `time-editions`, `platform-base-knowledge` and
`office-base-knowledge`. All five exist in WorkOS Production and are off (read
live 2026-11-12). So prod at that commit answers building law the way it does
today. CI (push) and Deploy (staging) were green on it. It carries migrations
`0192` to `0213`, Hatchet, the fetcher's predecessor, project mail (dark) and
the features merged up to 2026-11-10.

| | Promotion A | Promotion B |
|---|---|---|
| Pin | `b3fa243d73adb06832487b4bd3e18063aadb6658` | a green develop sha once Austria is stable on dev |
| Migrations | 0192–0213 | 0214–0235 |
| One-way door | Hatchet | the law cut-over and its window |
| Customer impact | none intended; quiet hour for the SeaweedFS restart and the migration lock | Austrian answers degraded from deploy until AT is stable on prod |
| Gate to start | Phase 0 done | A has run quietly for some days; AT stable on dev; both bundles exported |

Recommendation: **two promotions.** The cost is that A runs older code than
develop (it lacks the 2026-11-11 fixes: stuck-state lifecycles, the public-source
fetcher, the binding-edition retrieval), and that the decision is not written in
`rollover-to-prod.md`, which only considered `b3fa243d73` as a base for a
backport branch with the new door (its open question 1). A does not need the
new door: it only has to keep prod's answers as they are while Hatchet settles.

Not verified: that prod at `b3fa243d73` with the five flags off answers exactly
as today. CI runs both branches of each switch; staging ran with the flags on.
Check it with the "before" column of
[dev-acceptance.md](../design/international/dev-acceptance.md) on prod right
after A (Phase 1, step 12).

If the owner chooses one promotion instead, run Phase 0 and all of Phase 2
first (Austria stable on dev, both bundles exported), then Phase 1 with the
develop sha of Phase 3, then Phase 3 from its step 6. Phase 1 step 12's law
check does not hold on that sha: replace it with Phase 3 step 7's "before"
acceptance. Every risk below then lands in one window.

## Phase 0: before any promotion

Owner's list. Each line either is done, or the promotion waits.

| # | What | How | Who |
|---|---|---|---|
| 0.1 | Measure the migration lock (read-only, prod DB) | SQL in [§ The migration lock](#the-migration-lock) | Owner |
| 0.2 | Pre-build 0196's index online (a write on prod: ask first) | `CREATE UNIQUE INDEX CONCURRENTLY …` in the same section | Owner |
| 0.3 | Back up before the deploy | [§ Backups](#backups) | Owner |
| 0.4 | The prod stack's ESC environment (`pulumi config env ls --stack prod`) holds none of: `knowledgeSingleOperator`, `chromaEnabled`, `chromaImage`, `chromaStorageSize`, `qdrantEnabled`, `vectorBackend`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `JINA_API_KEY`, `LANGCHAIN_*`, `LANGSMITH_*`, `MODAL_TOKEN_*`, `SERPER_API_KEY`, `WANDB_API_KEY`. Note whether `LANGFUSE_PROMPTS_ENABLED` is set | `esc env get <that environment>` | Owner |
| 0.5 | Cluster headroom: `data` group (fixed 4 nodes) needs 2 × 4Gi for `background-work-pg` on two nodes plus 3 × 512Mi RabbitMQ; `Node` group about 4.5 vCPU / 8.6 GiB for Hatchet; `batch` up to 12Gi for the heavy ingest pool | `kubectl describe nodes -l k8s.at/node-group=<group> \| grep -A8 'Allocated resources'` | Owner |
| 0.6 | WorkOS check (read-only) | `WORKOS_API_KEY=<prod> task workspace:provision:authz` and `… :flags` | Owner |
| 0.7 | Decide the Hatchet rollback (see [§ Rollback](#rollback-across-hatchet)) and, if it is a revert PR, prepare it now | Owner | Owner |
| 0.8 | Legal and comms: the subprocessor list changed (63d777a4d, 0a37706df), the legal pages carry 19 `TODO(owner)` items (`apps/workspace/bff/legal/content/{de,en}.ts`), counsel sign-off on `docs/compliance/vendor-audit-2026-11.md` is open, and personal memory has no erasure path for leavers (ADR-0180). Decide what offices are told before the deploy | Owner, counsel | Owner |
| 0.9 | A quiet hour booked, and a `production` reviewer available | Calendar | Owner |

### The migration lock

`drizzle-kit migrate` applies every pending migration in **one transaction**
(`drizzle-orm/pg-core/dialect.js`, `session.transaction`). Every lock a
migration takes is held until the last one commits. In this jump that includes
`ACCESS EXCLUSIVE` on `document_versions` (0196's unique index build),
`organizations` (0200, 0203), `llm_usage_events` (0220) and `conversations`
(0230, Promotion B), and 0200 scans every tenant table with
`SELECT DISTINCT organization_id`. While the Job runs, the old pods' requests
on those tables wait and time out at Envoy: the app pauses.

Measure (read-only):

```sql
SELECT pg_size_pretty(pg_relation_size('document_versions')) AS heap,
       (SELECT reltuples::bigint FROM pg_class WHERE relname = 'document_versions') AS rows;
SELECT c.relname, c.reltuples::bigint
  FROM pg_class c JOIN information_schema.columns k
    ON k.table_name = c.relname AND k.column_name = 'organization_id'
   AND k.data_type = 'text' AND k.table_schema = 'public'
 ORDER BY 2 DESC;
```

Best: restore last night's backup somewhere and time `drizzle-kit migrate` on it.
Unless `document_versions` is tiny, build 0196's index online first, as the
owner, outside a transaction (0196 then adopts it, `USING INDEX`):

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "document_versions_id_project_id_key"
  ON "document_versions" ("id", "project_id");
SELECT indisvalid FROM pg_index
 WHERE indexrelid = 'document_versions_id_project_id_key'::regclass;  -- must be t
```

0200's scans cannot be moved out of the transaction. Deploy in a quiet hour.

### Backups

The CNPG archive sits on the in-cluster SeaweedFS, and `background-work-pg`
has no backup at all (no off-cluster bucket is configured). Before each
promotion:

```bash
kubectl cnpg status grid-pg -n grid                      # WAL archiving OK, note the primary
kubectl cnpg backup grid-pg -n grid                      # on-demand base backup
kubectl -n velero get backups.velero.io --sort-by=.metadata.creationTimestamp | tail -2   # last night's Completed
# Off-cluster logical copy:
kubectl -n grid exec <primary> -c postgres -- pg_dump -Fc -d app  > app-$(date +%F).dump
kubectl -n grid exec <primary> -c postgres -- pg_dump -Fc -d jobs > jobs-$(date +%F).dump
```

`0226` (Promotion B) drops `jobs`, `job_runs` and `tasks`, and its down file
recreates them empty. The `app` dump above keeps them.

## Phase 1: Promotion A (Hatchet and the platform)

### Before the merge

1. **Baseline the old queues** and check nothing would be stranded:

   ```bash
   kubectl cnpg psql grid-pg -n grid -- -d jobs -c \
     "SELECT 'ingest' q, status, count(*) FROM ingest_job_queue GROUP BY 2 UNION ALL
      SELECT 'research', status, count(*) FROM research_job_queue GROUP BY 2"
   kubectl cnpg psql grid-pg -n grid -- -d app -c "SELECT status, count(*) FROM bff_job_queue GROUP BY 1"
   # Must be 0: the ingest cutover refuses plaintext payloads and leaves them claimed.
   kubectl cnpg psql grid-pg -n grid -- -d jobs -c \
     "SELECT count(*) FROM ingest_job_queue WHERE status IN ('queued','claimed') AND payload NOT LIKE 'enc:%'"
   # Outlook imports that will cross the deploy (they resume, but mix notes and Verläufe):
   kubectl cnpg psql grid-pg -n grid -- -d app -c \
     "SELECT status, count(*) FROM mail_imports WHERE status IN ('uploading','queued','importing') GROUP BY 1"
   ```

2. **Make the promotion PR.** Prod's tree is develop `8cb6cf646` plus the pin
   line, so merging prod with `-s ours` loses nothing:

   ```bash
   SHA=b3fa243d73adb06832487b4bd3e18063aadb6658
   git fetch origin develop prod
   git switch -c release/promote-${SHA:0:9} $SHA
   git merge -s ours origin/prod -m "chore(release): merge prod into the promotion of develop ${SHA:0:9}"
   sed -i -E "s/^(  [a-z-]+:imageTag:).*/\1 sha-$SHA/" deploy/pulumi/Pulumi.prod.yaml
   git diff origin/prod -- deploy/pulumi/Pulumi.prod.yaml | grep imageTag   # must show sha-b3fa243d…
   git commit -am "chore(release): pin prod to develop ${SHA:0:9}"
   git push -u origin release/promote-${SHA:0:9}
   ```

   Then open a PR to `prod` titled
   `chore(release): promote develop b3fa243d7 to prod`.

   **The pin trap.** develop's `Pulumi.prod.yaml` pins
   `sha-9150f95df04ddc393507dd2dca7bb69415062b38` (2026-09-18). The prod job has
   no downgrade guard (the vector-store floor only warns when it cannot find the
   commit), so merging that line unchanged rolls prod back to September with
   nothing turning red. The `grep` above is the check.

   Keep the project-mail block, the off-cluster backup block and `cmsEnabled:
   "false"` as they are. `mcpGatewayEnabled: "true"` creates
   `platform-mcp.<baseDomain>` with a certificate and a Cloudflare A record. It
   needs the WorkOS Production resource indicator and the JWT `roles` claim
   ([platform-mcp-gateway.md](platform-mcp-gateway.md)). If those are not
   confirmed, set it to `"false"` for this promotion.

3. **Preview by hand before merging.** The deploy job previews only after the
   merge.

   ```bash
   cd deploy/pulumi && pulumi stack select prod
   pulumi preview --policy-pack ./policy --diff
   ```

   Expect creates: namespace `background-work`, `background-work-pg`, the
   RabbitMQ operator ConfigFile and `hatchet-rabbitmq`, Helm release `hatchet`,
   Jobs `hatchet-token-sync` and `background-work-pg-grants`, the Hatchet
   NetworkPolicies, `hatchet-queue-auth`, `ingest-worker-heavy`,
   `platform-mcp-gateway` and its DNS record. Updates: the ScaledObjects, env
   on seven tiers, the `seaweedfs` StatefulSet (memory). Deletes:
   `skill-scheduler`, the geocoder, the queue-scaler grants. **No update on the
   `grid-pg` Cluster.** Anything else: stop and read it.

### The deploy

4. In the quiet hour: merge, approve `production`. Watch:

   ```bash
   kubectl -n background-work get pods,jobs -w
   kubectl -n background-work logs job/hatchet-token-sync      # ends with "worker token copied"
   kubectl -n grid get jobs                                    # grid-app-migrate, authz-catalog: Complete
   ```

   The job has 60 minutes (`deploy.yml`). The first apply builds the CNPG
   cluster, three RabbitMQ nodes and the Helm release (up to 20 minutes on its
   own) before any tier rolls. If a pod sits `Pending` (the heavy ingest pool
   did on staging), read why at once instead of waiting out the timeout. Every
   app tier waits for `hatchet-token-sync`: if the platform does not come up,
   nothing rolls, and the old pods keep serving.

5. `seaweedfs-0` restarts (1Gi/4Gi memory). Uploads and downloads fail while it
   is down.

### Right after the deploy, in this order

6. **Wait until no old pod is left.** Old api and chat pods still write
   `research_job_queue` while they drain, and an old agent-worker may hold a
   claimed job for up to `agentWorkerDrainSeconds` (600 s).

   ```bash
   kubectl -n grid get pods -o custom-columns=N:.metadata.name,I:.spec.containers[0].image | grep 331b9d91   # empty
   kubectl -n grid get deploy skill-scheduler                                                                # NotFound
   ```

7. **Re-dispatch the research queue. Nothing else does it.**

   ```bash
   kubectl -n grid exec deploy/agent-worker -- python -m agent_host.jobs.requeue_legacy
   ```

   It prints `started X, already terminal Y, already on Hatchet Z, unreadable N`
   and is safe to run twice. Running it before step 6 can start a job twice.

8. **Ingest needs no command:** every new ingest worker moves the old queue's
   rows in batches of 500 a minute. Check
   `kubectl -n grid logs deploy/ingest-worker | grep 'Ingest cutover'` for
   `N job(s) moved`. Optional by hand: `python -m agent.knowledge.ingest_cutover`.
   `bff_job_queue` rows and automations need nothing: the BFF sweep and
   `schedule-repair` pick them up within five minutes
   (`schedule repair: scheduled N definition(s)` in the bff-jobs log).

9. **Run the base-corpus sync now.** Base-corpus chunks without a country are
   read by nobody until the first sync marks them AT. The CronJob runs every 10
   minutes; do not wait for it:

   ```bash
   kubectl -n grid create job --from=cronjob/housekeeping-base-corpus base-corpus-now
   kubectl -n grid logs job/base-corpus-now -f   # "Marked <n> base-corpus file(s) from before the country field as AT"
   ```

   (Namespace unverified; the CronJob name is `BASE_CORPUS_SYNC` in
   `deploy/pulumi/src/app/workers.ts`.)

10. **Watch the old tables empty** (the SQL of step 1). `queued` and `claimed`
    go to 0. `dead` rows stay until a later drop migration.

### Verify A

11. Platform:

    - `kubectl -n background-work get pods`: 2 × hatchet-api, -grpc,
      -controllers, -scheduler, frontend, caddy, 3 × `hatchet-rabbitmq-server-*`,
      2 × `background-work-pg-*`, all Running.
    - `kubectl cnpg status background-work-pg -n background-work`: primary and one streaming replica.
    - `kubectl -n background-work exec hatchet-rabbitmq-server-0 -- rabbitmq-diagnostics cluster_status`: 3 nodes.
    - `kubectl -n grid get scaledobject`: READY and ACTIVE, no scaler errors in `describe`.
    - Dashboard: `kubectl -n background-work port-forward svc/caddy 8080:8080`;
      password from `secret hatchet-shared-config`, key `ADMIN_PASSWORD`. Workers
      lists agent-worker, ingest-worker and bff-jobs; Crons lists
      `runs-reconcile`, `reconcile-background-work`, `upload-sweep`,
      `schedule-repair`, `folder-cards-sweep`, `frist-reminder`, and the
      every-minute ones show a run each minute.

12. Functions, in a test office:

    - Upload a small PDF: an `ingest-document` run, the document ready without
      a reload, a Langfuse trace.
    - Upload a file of 40 MiB or more: `ingest-document-heavy`, a heavy pod on
      `batch`, back to 0 afterwards.
    - Start and cancel a research run.
    - An automation due in five minutes fires once.
    - A building-law question on an Austrian project answers as before: it
      names the OIB edition as today and derives a building class. This is the
      check that the five flags kept the old path.
    - A project with no stated site no longer gets Austrian law (#1545, not
      behind a flag): the agent asks where the project is. Migration 0201 gives
      projects with an Austrian address their Land from the postal code, so
      this hits only projects without an address. Intended, but offices notice.
    - `POST /api/internal/signed/inbound-mail` answers 503 (mail is dark).

### After A

13. Operator actions from the release notes, none urgent:

    - `task langfuse:provision` (check), then `-- --apply` on the owner's yes.
    - **Rescan failed ingestions** (Organization → Enterprise) for the offices
      with `Job ID not found` rows (446 on 2026-11-07). It retries every failed
      document of that org.
    - Optionally `VALIDATE CONSTRAINT` for 0222 and 0223 after checking the rows.

14. **Let it run.** A few working days with real load. Watch the Hatchet
    dashboard, the KEDA scalers and PostHog errors, and roll forward with fixes
    from develop.

## Phase 2: between the promotions

1. **Austria on dev: stable since 2026-11-12** (release sequence 636 from
   `5907f5cb` and `d76b4ca3`, coverage `core`, 312 records, 49 texts). The QC
   run of that day ([dev-acceptance.md, run of 2026-11-12](../design/international/dev-acceptance.md#run-of-2026-11-12-austria-after-coverage-core))
   found the binding matrix correct and left work that decides what prod
   offices see after B. Settle these before exporting:
   - **No platform edition is ever checked** (finding 1). Every AT turn tells
     the model to say the edition was never checked against its source, and
     with #1700 an answer that names an open point is capped at medium. So AT
     answers stay mostly medium after B until a check operation writes
     `knowledge_checks` for platform editions. That needs an owner decision and
     a PR; it is not a promotion step.
   - **Titles and doc classes** (findings 2, 3). #1682 stamps a title at
     publish; the 49 texts released before it need
     `platform-knowledge-title-update` once, and every text its doc class, or
     citations show file names and a doc-class search finds only the legacy
     copies. Do it on dev before the export, so the bundle carries them.
   - **Drafts still to review and publish on dev**: `c72e03ea` (five
     Erläuterungen with no text), `b79ef256` (Salzburg RL 6 2015 binding
     2016–2026, a gap until then), `9dd4d3f0` (the 28 golden cases).
   - Then pass the "after" column again. Export reads stable heads only.
2. **Export and rehearse.**
   `platform-knowledge-release-export {countryId:"EU"}` and `{countryId:"AT"}`.
   Keep the files. Import them into a fresh local database
   (`release-transfer.integration.spec.ts` pattern): validate green, hashes equal.
3. **Name two prod people** for import and review. They must be two humans:
   WorkOS Production has four Platform Owner accounts for three people, and the
   database's "approver is not the author" check compares user ids, so a second
   account of the same person passes it. Nobody uses `approve_alone` on prod.
4. **Keep the freeze.** No PR deleting `packages/ris-adapter`,
   `rulesets/shipped.ts` and its seeds, `backfill_legacy_marks` or the norm
   registry (#1630, #1644) merges before Phase 3 step 9. The Normenkatalog and
   Basiswissen pages are already gone (6a127e852, 9c26bb9bc); their sync moved
   to Platform → Maintenance.
5. **WorkOS permissions.** `platform:knowledge:*` do not exist in WorkOS
   Production. B's catalog Job creates them, but if that Job fails nobody can
   sync, import or review. On the owner's yes, run
   `task workspace:provision:authz -- --apply` from B's sha before B.
6. **Book the reviewer** for the whole window. Plan a full working day: every
   imported capture arrives `operator_supplied`, so the prod reviewer
   source-checks each of them (49 texts).

## Phase 3: Promotion B (the law cut-over)

1. Pick a develop sha whose CI push run and staging deploy are green and that
   contains the AT pack state of Phase 2. `f6facbb945e81ecc88fce4d9d686da9dbecb43a3`
   was the newest such on 2026-11-11; take a newer one if it exists.
2. Backups (Phase 0.3) and the lock measurement again: B brings 0214–0235,
   including `conversations` (0230) and `llm_usage_events` (0220) under the
   batch lock.
3. Promotion PR as in Phase 1 step 2, with the new sha. The same pin check.
   That recipe takes develop's `Pulumi.prod.yaml` and drops prod's, so carry
   over every line A's promotion set differently from develop (for example
   `mcpGatewayEnabled: "false"`): compare
   `git diff origin/prod <new sha> -- deploy/pulumi/Pulumi.prod.yaml` before the
   commit, and keep prod's value on each line that is not the pin.
4. Manual preview. Expect the public-source fetcher (new Deployment, private
   image with the pull secret) and no surprise.
5. Deploy early on a working day, with the reviewer ready. From here until
   step 8, Austrian offices are in the window (below).
6. **Base-corpus sync now** (Phase 1 step 9), then check the api pod's env:
   `KNOWLEDGE_SINGLE_OPERATOR=false`.
7. **"Before" acceptance on prod** with the test office (A1–A8 "before", D4, D5).
   It confirms the degraded state is the designed one.
8. **Import and publish**, as in rollover steps 6 to 8:

   - EU: `platform-knowledge-release-import`, attach the texts
     (`text-import` or `text-upload`), `platform-knowledge-validate` until green,
     submit. The second person reviews and approves as `domain_expert` with
     four eyes. Publish to `preview`, then `stable`.
   - AT: the same, with 49 texts and any follow-up release of Phase 2. AT import is refused with
     `REFERENCE_NOT_RELEASED` until EU is stable.
   - Green when `platform-knowledge-index-status` shows every text `indexed`.
     The gate changes on the next turn.

9. **"After" acceptance on prod** (A1–A8, D1–D5). Langfuse shows `gate=core`
   for Austrian sites, and `binding-claim-without-records` and
   `law-cited-from-web` are 0 on these runs.
10. **Follow-up packs**, each a change request on dev first, then
    export/import/review: `at-setup` (with the territory zone), `at-sources`,
    `at-scopes`, `at-citation-styles`, `at-golden-cases`. Until they are
    published, setup, the law lookup and citation lines use the built-in
    fallbacks, as before.

### What Austrian offices see in the window

From B's deploy until step 8:

- Answers still read the corpus and RIS and quote correctly.
- No edition is named binding, and no citation shows a binding chip.
- Any answer citing building law is capped at medium confidence, with the chip
  "Mittlere Sicherheit … noch nicht geprüft".
- No building class is derived: the profile hides it and
  `classification-evaluate` answers `undetermined`.
- Formula cards (U-value, stair, escape route, daylight) show a hint, not a
  verdict.
- The IFC model check gives no pass or fail either (#1657): it shows the value
  it read as a note, and puts nothing on "Was dem Modell fehlt" or up for
  confirmation in the Prüfbuch.
- The setup's law card reads "Für diesen Standort ist noch kein Recht erfasst."
- **A loss that stays:** a document reading that writes intake values on an
  Austrian project in the window removes the stored derived building-class
  suggestions of its buildings (`project-intake/service.ts`, `lawWithheldAt`).
  They come back only on a later reading after AT is stable. A class a document
  stated or a person confirmed stays. Read in the code, not exercised.

The gate's cap lifts on the first turn after AT is stable. Answers stored in
the window keep their level, and until platform editions are checked (Phase 2,
finding 1) most AT answers stay at medium for that reason instead.

## Phase 4: project mail (separate, later)

A and B ship mail dark: the routes exist, the webhook answers 503, nothing is
created at Cloudflare. Two things are not dark:

- **The Outlook import changes for every office with `mail-import`.** Mail text
  now goes into E-Mail-Verläufe instead of one note per mail. An import running
  across the deploy resumes and ends up mixed. Tell those offices.
- 0196's lock (Phase 0).

Turning it on is three more promotions, each with its own gates, in
[project-mail-runbook.md](project-mail-runbook.md): (1) `malwareScanEnabled`
alone, wait for ClamAV to be ready (freshclam reaches `database.clamav.net`);
(2) the mail domain (`inbox.` on the brand domain, `Pulumi.prod.yaml`), paused, then gates G0, G4 (paused) and G7;
(3) unpause for the test office only, gates G1–G6 and G9. Before (2):

- an account-owned Cloudflare token with the mail scopes **and** prod's
  existing DNS scopes on the current `baseDomain` (a missing scope stops the apply half-way);
- the first DMARC record on the brand domain (the company's Google Workspace domain);
- dev's own G0–G7 runs recorded (they never were: dev was unpaused without G0);
- the data-protection sign-off before any customer office gets `inbound-mail`.

The first apply of (2) fails at the postmaster@ and abuse@ forwards (Cloudflare
error 2054) until the verification link at the operator address is clicked.
That is expected. Never call `…/email/routing/enable` on the zone: its apex MX
are Google's. Mail does not need the domain cutover first; if the cutover comes
later, pause mail during its apply.

## Phase 5: afterwards

- Delete the retired WorkOS flags (project-wide, staging and production at
  once): `knowledge-context`, `building-law-chain`, `time-editions`,
  `platform-base-knowledge`, `office-base-knowledge`, `source-routing`, and
  `project-mail-inbox` on the owner's yes. **Not before B is live:** A still
  reads the first five.
- `task prompts:push` (check). Prompt management is off on prod
  (`LANGFUSE_PROMPTS_ENABLED` unset), so publishing is hygiene.
- Lift the freeze after stable has held for the agreed time; retire the legacy
  AT-marked OIB PDFs or keep them as the rollback floor (rollover open
  question 2).
- Off-cluster bucket for `pgBackup*` and `backgroundWorkPgBackup*` together:
  setting only one makes the plan refuse (`refuseInClusterAppArchive`).
- The domain cutover to the brand domain is its own change
  ([domain-cutover.md](domain-cutover.md)).
- A fixed promotion cadence, so the next release is not this one again
  (Notion ticket 97).

## Rollback across Hatchet

The auto-generated rollback in the deploy summary
(`-f imageTag=sha-331b9d91…`) re-pins the old images **under the new program**.
After A that leaves prod degraded, not as it was:

- `skill-scheduler` is gone, and the old images have no Hatchet crons:
  automations stop, and so do the sweeps the old scheduler drove (background
  reconcile, upload sweep, placement, trace retention, usage export).
- KEDA scales the workers on Hatchet's backlog, which old code never writes:
  agent-worker, ingest-worker and bff-jobs sit at their floor.
- Jobs moved to Hatchet (research by `requeue_legacy`, ingest by the cutover)
  are no longer in the old tables.

A full rollback is a PR to `prod` restoring `f48bdcc4c`'s `deploy/pulumi`.
Pulumi then refuses to delete the protected `background-work-pg` and
`hatchet-rabbitmq` and the update fails; it needs `pulumi state unprotect` or a
hybrid program that keeps the Hatchet platform idle. Decide which before A
(Phase 0.7). Rolling forward with a fix from develop is the expected path.

Schema: all of 0192–0235 are additive toward the old image except 0226, which
drops tables the old image declares but no longer queries. The old image runs
on the new schema.

Before B, rolling back B by tag to A's sha is the same kind of re-pin and keeps
Hatchet. After AT is published, roll back AT with `platform-knowledge-rollback`
(AT before EU): the gate returns to `none` and the legacy OIB copies answer.

## Risks, ranked

1. **The pin trap**: develop's prod stack file pins September, and the prod job
   has no downgrade guard. Check the diff before merging.
2. **`requeue_legacy` forgotten, or run before the old pods are gone**: research
   jobs stranded or started twice. Nothing automates it.
3. **No image rollback across Hatchet**: decide and prepare the path before A.
4. **The migration batch pauses the app**: one transaction, exclusive locks on
   hot tables, 0200's full scans. Measure, pre-build the index, quiet hour.
5. **The law window has no end** if AT is not stable on dev before B; with it,
   plan a full day of review.
6. **Two-person rule on prod**: three humans, four accounts; the database cannot
   tell one person's two accounts apart.
7. **The 60-minute deploy job** against a first build of Hatchet, CNPG and
   RabbitMQ on capacity nobody has checked.
8. **No alerting on Hatchet or RabbitMQ** (the alert rules ConfigMap is not
   evaluated), no backup of `background-work-pg`, and the app archive is still
   in the cluster.
9. **Building-class suggestions lost** by document readings in B's window.
10. **Legal and comms**: subprocessor changes, open legal TODOs, personal memory
    without an erasure path, and the Outlook import change.

## Open owner decisions

1. Two promotions or one.
2. The Hatchet rollback path (tag only, revert PR prepared, or documented unprotect).
3. Pre-build 0196's index; accept the measured lock.
4. Platform MCP gateway on in A, or after confirming WorkOS.
5. Pre-apply the authz catalog before B.
6. The two prod knowledge people.
7. What offices are told, and when: subprocessors, rename, personal memory,
   Outlook import, the law window.
8. Personal memory as is, or hold `memory-reflection` until erasure exists.
9. `ingest-worker-heavy` on in A, or later (it never ran on staging).
10. `posthogTracesEnabled` and `geocoderUrl` on prod.

# Production release, November 2026: develop to prod

The runbook for the first promotion since 2026-10-28. It is a one-off. It puts in
order the steps the area runbooks each describe for their own part
([hatchet.md](hatchet.md), [project-mail-runbook.md](project-mail-runbook.md),
[rollover-to-prod.md](../design/international/rollover-to-prod.md),
[cd.md](cd.md), [rollback.md](rollback.md)), and covers what only shows when
all of it lands at once.

Prod runs `sha-331b9d9117661b201c762a7017f9c0d17ec21866` (the content of
develop `8cb6cf646`), with migrations through `0191`. This revision was written
on 2026-11-14 for one promotion of a develop commit that contains PR #1678.
Nothing here was run against prod. **Unverified** marks statements read from
code, not from the cluster, ESC or WorkOS.

## What the jump is

- **Migrations `0192` to `0239`**, applied in one transaction (below).
- **Background work moves to Hatchet** (ADR-0150): a new namespace with RabbitMQ,
  a second CNPG cluster and the Hatchet engine. The scheduler Deployment goes.
  There is no switch.
- **Building law becomes country records** (ADR-0175, ADR-0176). There is no
  switch here either. The Job `knowledge-carry` brings dev's reviewed EU and
  Austria releases to prod in the same deploy (ADR-0181), so the degraded window
  lasts only until that Job has published Austria.
- **Project mail is live for every office** (ADR-0137, ADR-0138). The mail block
  in `Pulumi.prod.yaml` is on, and the WorkOS flag `inbound-mail` has been ON for
  all organizations in Production since 2026-11-14.
- **The office's own standards stay dark.** The flag `office-standards`
  (`flag_01M7CW4BX9VF2YDVSGA4NK1HZG`, an entitlement) is OFF in Production until an office
  is targeted ([workos-provisioning.md](workos-provisioning.md)).
- What customers notice: the release overview artifact (private; ask the owner).

## What still needs a person

Everything else in this document runs by itself. Four things do not:

| # | What | Where | When |
|---|---|---|---|
| H1 | Replace prod's `cloudflareApiToken` with an account-owned token. It needs the mail scopes on the inbound mail zone ([project-mail-runbook.md §4](project-mail-runbook.md)) **and** every scope prod's DNS block uses on the current base domain today (Zone · DNS · Edit, Zone · Zone · Read, Single Redirect · Edit). Prove it first with `CLOUDFLARE_API_TOKEN=<token> deploy/pulumi/scripts/check-cloudflare-token.sh --stack prod` | Cloudflare → Manage Account → Account API Tokens; then the prod stack's ESC environment, key `cloudflareApiToken` | Before the merge. A missing scope fails the preview, or the apply half-way |
| H2 | Start the promotion: Actions → **Promote to prod** → Run workflow on `develop`. On the first run, enter the develop commit in `sha` (40 hex). With the input empty, the workflow takes the newest commit that has `CI OK` and the `deploy/staging` status, and only staging deploys from PR #1678 on set that status | GitHub Actions, `promote.yml` | After PR #1678 is on develop and staging is green on it |
| H3 | Merge the promotion PR to `prod`, then approve the `production` environment | GitHub, the PR the workflow opened | In a quiet hour (the migration lock, below) |
| H4 | Optional: set the `production` environment's secret `INBOUND_MAIL_TEST_ADDRESS` to a test office's project address (never a customer's), so the deploy also runs gate G3 over the signed route | GitHub → Settings → Environments → `production` | Before H3. Without it the job summary says G3 was skipped |

## Pre-flight

### Checked by the pipeline, not by you

- **The pin.** `promote.yml` writes `Pulumi.prod.yaml` as develop's, plus what
  prod changed on its own branch, with `imageTag` pinned to the chosen commit
  (`promote-stack-file.sh`). develop's copy pins a September build. The prod
  job's **Refuse a downgrade** step (`deploy/pulumi/scripts/prod-downgrade-guard.sh`)
  stops a pin older than what prod runs, before the apply.
- **The images exist** in GHCR (`verify-image-tag.sh`, in the workflow).
- **The 0196 index** is built online by the Job `online-indexes`
  (`deploy/pulumi/src/app/online-indexes-job.ts`) before the migration Job, and
  0196 adopts it (`USING INDEX`).
- **The bundles** are the ones dev released: `carry-manifest.spec.ts` fails a
  bundle whose uncompressed sha256, seq, counts or texts differ from
  `apps/workspace/config/knowledge-releases/manifest.json`, and the Job checks
  the same again before it writes anything.
- **WorkOS permissions.** The Job `grid-app-authz-catalog` creates the
  `platform:knowledge:*` permissions on every deploy. The carry does not need them:
  it runs as its own actor under `KNOWLEDGE_SINGLE_OPERATOR`, set in its pod only.

### Read once, before H3 (read-only)

| # | What | How |
|---|---|---|
| P1 | Cluster headroom. The `data` group (4 fixed nodes) needs 2 × 4Gi for `background-work-pg` on two nodes plus 3 × 512Mi for RabbitMQ. The `Node` group needs about 4.5 vCPU / 8.6 GiB for Hatchet. `batch` needs up to 12Gi for the heavy ingest pool | `kubectl describe nodes -l k8s.at/node-group=<group> \| grep -A8 'Allocated resources'` |
| P2 | The prod ESC environment holds none of the retired keys: `knowledgeSingleOperator`, `chromaEnabled`, `chromaImage`, `chromaStorageSize`, `qdrantEnabled`, `vectorBackend`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `JINA_API_KEY`, `LANGCHAIN_*`, `LANGSMITH_*`, `MODAL_TOKEN_*`, `SERPER_API_KEY`, `WANDB_API_KEY` | `pulumi config env ls --stack prod`, then `esc env get <it>` |
| P3 | WorkOS slugs exist. `workspace:provision:flags` checks **only that each registry slug exists**, not its state. This promotion relies on no retired flag: `knowledge-context`, `building-law-chain`, `time-editions`, `platform-base-knowledge` and `office-base-knowledge` are read by no code after #1578, and they were read off in Production on 2026-11-12 and 2026-11-14. The states that matter here are `inbound-mail` (ON) and `office-standards` (OFF), and they are read in the WorkOS dashboard, Production | `WORKOS_API_KEY=<prod> task workspace:provision:authz` and `… :flags` |
| P4 | Nothing stranded in the old ingest queue. A plaintext payload is refused by the cutover and stays claimed. Must be 0 | `kubectl cnpg psql grid-pg -n grid -- -d jobs -c "SELECT count(*) FROM ingest_job_queue WHERE status IN ('queued','claimed') AND payload NOT LIKE 'enc:%'"` |
| P5 | Outlook imports that will cross the deploy. They resume, but end up with notes and Verläufe mixed. Tell those offices | `… -d app -c "SELECT status, count(*) FROM mail_imports WHERE status IN ('uploading','queued','importing') GROUP BY 1"` |
| P6 | Legal and comms. The subprocessor list changed, the legal pages carry `TODO(owner)` items (`apps/workspace/bff/legal/content/{de,en}.ts`), counsel's sign-off on `docs/compliance/vendor-audit-2026-11.md` is open, and personal memory has no erasure path for leavers (ADR-0180). Decide what offices are told | Owner, counsel |

### Backups

The CNPG archive sits on the in-cluster SeaweedFS, and `background-work-pg` has
no backup at all. Right before H3:

```bash
kubectl cnpg status grid-pg -n grid                      # WAL archiving OK, note the primary
kubectl cnpg backup grid-pg -n grid                      # on-demand base backup
kubectl -n velero get backups.velero.io --sort-by=.metadata.creationTimestamp | tail -2   # last night's Completed
kubectl -n grid exec <primary> -c postgres -- pg_dump -Fc -d app  > app-$(date +%F).dump
kubectl -n grid exec <primary> -c postgres -- pg_dump -Fc -d jobs > jobs-$(date +%F).dump
```

`0226` drops `jobs`, `job_runs` and `tasks`, and its down file recreates them
empty. The `app` dump keeps them.

### The migration lock

`drizzle-kit migrate` applies every pending migration in **one transaction**.
Every lock is held until the last migration commits. That includes
`ACCESS EXCLUSIVE` on `organizations` (0200, 0203), `llm_usage_events` (0220) and
`conversations` (0230). 0200 also scans every tenant table. While the Job runs,
old pods' requests on those tables wait, and Envoy times them out: the app
pauses. The online index takes 0196's build out of that window, but not its
catalog lock ([kubernetes.md](kubernetes.md)). Measure the large tables if you
want a number:

```sql
SELECT c.relname, c.reltuples::bigint
  FROM pg_class c JOIN information_schema.columns k
    ON k.table_name = c.relname AND k.column_name = 'organization_id'
   AND k.data_type = 'text' AND k.table_schema = 'public'
 ORDER BY 2 DESC;
```

Deploy in a quiet hour.

## The deploy

After H3 the prod job runs these steps, in this order. It has 60 minutes.

1. **Plan, policy, Refuse a downgrade.** A refused pin ends the job, with
   nothing changed.
2. **`pulumi up`.** It creates the `background-work` namespace,
   `background-work-pg`, the RabbitMQ operator and `hatchet-rabbitmq`, the Helm
   release `hatchet`, `hatchet-token-sync`, `background-work-pg-grants`, the
   NetworkPolicies, `ingest-worker-heavy`, the public-source fetcher, ClamAV and
   the mail Worker and rules. It deletes `skill-scheduler`, the geocoder and the
   queue-scaler grants, and restarts `seaweedfs-0` (uploads fail while it is
   down). Every app tier waits for `hatchet-token-sync`: if the platform does
   not come up, nothing rolls and the old pods keep serving. A pod in `Pending`
   (the heavy ingest pool did this on staging): read why at once.
3. **Jobs inside the apply**, by dependency:
   - `online-indexes`: builds `document_versions_id_project_id_key`
     concurrently, or skips it when the index exists.
   - `grid-app-migrate`: 0192 to 0239. Green: `Complete`.
   - `grid-app-authz-catalog`: the permission catalog into WorkOS Production.
   - `hatchet-token-sync`: ends with `worker token copied`.
   - `knowledge-carry-<digest>` (`knowledgeCarry: "true"`), **not awaited**,
     started after the api tier, the fetcher, the frontend, `bff-jobs` and the
     ingest workers have rolled. Its log is one JSON line per step. For EU, then
     AT, green reads: `bundle verified` → `imported` → `text attached` (AT: 54)
     → `submitted` → `reviewed` → `approved` → `published` (preview, then
     stable) → `waiting for the corpus` … `texts ingested` → `texts labelled`.
     Then `legacy copies retired`, `finished`, and
     `building classes rederived` with `failed: 0, complete: true`. Exit 0. It
     waits up to 30 minutes for the ingest of each country's texts. A failure
     exits 1, and the Job's retries (`backoffLimit: 3`) resume from where the
     request stands.
4. **Project mail – subaddressing**
   (`scripts/inbound-mail-after-deploy.sh subaddress`): GET, then PATCH only
   when it is off. A refusal fails the job.
5. **Smoke check.**
6. **Project mail – launch gates**: G7 (rules and Worker at Cloudflare), and G3
   once H4 is set. The results are in the job summary.

Things that move on their own once the new pods run, with nothing to type:

- **Research queue**: every new agent-worker runs the cutover loop
  (`apps/agent-host/src/agent_host/jobs/requeue_legacy.py`) once a minute. It
  moves a `claimed` row only after its claim has been silent past the old
  worker's drain budget, and stops after an hour with nothing to move. By hand:
  `python -m agent_host.jobs.requeue_legacy` (`--force` once the old pods are
  gone).
- **Ingest queue**: every new ingest worker moves old rows in batches of 500 a
  minute (`Ingest cutover: N job(s) moved`).
- **`bff_job_queue`**: `dispatchStrandedJobs` (`bff/jobs-queue/task-run.ts`)
  runs every minute and starts up to 200 rows that have been due for 120 s.
  **Automations**: `schedule-repair` gives every enabled definition its Hatchet
  run within five minutes.
- **Legacy corpus marks**: the base-corpus sync (CronJob
  `housekeeping-base-corpus`, every 10 minutes) marks the corpus from before the
  country field as AT, once (`oib_sync.backfill_legacy_marks`). Until it runs,
  those chunks are read by nobody. To run it now:
  `kubectl -n grid create job --from=cronjob/housekeeping-base-corpus base-corpus-now`.

### What Austrian offices see until the carry has published AT

From the frontend rollout until AT is stable (normally the carry's first half
hour): no edition is named binding, building-law answers are capped at medium
confidence, no building class is derived, and formula cards and the IFC check
show a hint instead of a verdict. A document read in that window that writes
intake values removes its buildings' derived class suggestions
(`project-intake/service.ts`, `lawWithheldAt`). The carry's re-derivation brings
the derived classes back once AT is stable. A class a document stated or a
person confirmed stays.

### Existing projects

What is recorded wins (`sitePlacement`, `bff/base-knowledge/context/site.ts`):
a confirmed Land or country, then a recorded assumption (0201's postal-code
Land), then the Land of the stored address, then 0018's office default. Only a
project with no place recorded at all is placed in the office's default
territory (Vienna for AT). That placement is used only in the gate and the turn,
and is never written into the profile, so no office sees an assumption it never
made. The carry's `rederiveBuildingClasses` records only the Land an address
already gives, and derives every building's class from the released records.

## Verify

1. Platform: `kubectl -n background-work get pods` shows 2 × hatchet-api,
   -grpc, -controllers and -scheduler, plus frontend, caddy,
   3 × `hatchet-rabbitmq-server-*` and 2 × `background-work-pg-*`, all Running.
   `kubectl -n grid get scaledobject` shows READY and ACTIVE. In the dashboard
   (`kubectl -n background-work port-forward svc/caddy 8080:8080`, password from
   `secret hatchet-shared-config` key `ADMIN_PASSWORD`), Workers lists
   agent-worker, ingest-worker and bff-jobs, and the every-minute crons show a
   run each minute.
2. The carry: `kubectl -n grid logs job/<knowledge-carry-…>` ends as described
   in step 3, and the Job is `Complete`. `platform-knowledge-index-status` on
   each carried request shows every text `indexed`, and
   `platform-knowledge-base-get {countryId: AT, nameContains: "-text-", brief: true}`
   shows no text as `other`.
3. In a test office:
   - A small PDF ingests (`ingest-document`). A file of 40 MiB or more runs
     `ingest-document-heavy` on `batch`.
   - Start and cancel a research run.
   - An automation due in five minutes fires once.
   - Austrian building law: the answer names the binding edition, and a building
     class is derived. Langfuse shows `gate=core`, and
     `binding-claim-without-records` and `law-cited-from-web` are 0. The "after"
     column of [dev-acceptance.md](../design/international/dev-acceptance.md).
   - Project mail: the project shows its address. A mail from outside lands in
     the E-Mail-Eingang ([project-mail-runbook.md](project-mail-runbook.md), G1
     to G6). `kubectl -n grid rollout status deploy/clamav --timeout=30m`.
   - The office's own standards are not in the rail (flag OFF).
4. Afterwards, none of it urgent: `task langfuse:provision` (check, then
   `-- --apply` on the owner's yes), and **Rescan failed ingestions** for the
   offices with `Job ID not found` rows.

## Rollback across Hatchet

The rollback the deploy summary prints (`-f imageTag=sha-331b9d91…`) re-pins
the old images **under the new program**. That leaves prod degraded, not as it
was:

- `skill-scheduler` is gone and the old images have no Hatchet crons.
  Automations stop, and so do the sweeps the old scheduler drove. The
  housekeeping CronJobs stay (`deploy/pulumi/src/app/workers.ts`).
- KEDA scales the workers on Hatchet's backlog, which old code never writes:
  agent-worker, ingest-worker and bff-jobs sit at their floor.
- **Jobs the cutover moved, or that new code started on Hatchet, are not in the
  old tables, and the old workers never pick them up:**
  - *Ingest*: the document stays unfinished. "Erneut lesen" starts it again on
    the old queue.
  - *Research, running*: the run stops heartbeating when its pod is replaced.
    The old image's ghost-job reaper (`routes/job_reaper.py` at prod's commit:
    `GHOST_JOB_TIMEOUT_SECONDS = 300`, reaping `RUNNING` only), called every two
    minutes by the CronJob `housekeeping-ghost-jobs` (`workers.ts:364`), marks
    it **failed** ("Job timed out (no heartbeat received from worker)") within
    about seven minutes, and reports that to the BFF. The person starts it again.
  - *Research, still waiting* (`SUBMITTED`): nothing runs or reaps it. The
    reaper skips `SUBMITTED`, and the old expiry touches only terminal jobs
    (`_TERMINAL_STATUSES` in `jobs/access.py`). It shows as waiting until the
    person cancels it.
  - *`bff_job_queue`*: the row stays the job's record, and the old image's sweep
    reads it as before (**unverified** for a row Hatchet already started).

A full rollback is a PR to `prod` that restores `f48bdcc4c`'s `deploy/pulumi`.
Pulumi then refuses to delete the protected `background-work-pg` and
`hatchet-rabbitmq`, and the update fails. It needs `pulumi state unprotect`, or
a hybrid program that keeps the Hatchet platform idle. Before you idle it, let
running research finish or cancel it, and accept that waiting research runs end
as above. The expected path is rolling forward with a fix from develop.

Schema: 0192 to 0239 are additive toward the old image, except 0226, which drops
tables the old image declares but no longer queries.

Law: `platform-knowledge-rollback` (AT before EU) returns the gate to `none`.
The carry has deleted the legacy copies of the released texts, so a rollback
does not bring back today's answers. Roll forward.

## Risks, ranked

1. **H1 not done, or a scope missing**: the apply stops at the first Cloudflare
   resource. Tiers that already rolled stay rolled.
2. **No image rollback across Hatchet**: see above. Roll forward.
3. **The migration batch pauses the app**: one transaction, exclusive locks on
   hot tables, 0200's full scans. Quiet hour.
4. **The carry cannot fetch a text**: prod's fetcher must reach the publisher
   (**unverified** from prod). The Job retries three times, then stays failed,
   and AT stays in the window (a country stopped in a draft is read by no
   office). Read its log and fix the cause. A redeploy plans no new Job while
   the bundles are unchanged, so run it again with
   `pulumi up --replace '<its URN>'` in `deploy/pulumi` (the URN:
   `pulumi stack --show-urns | grep knowledge-carry`). It skips what stable
   already holds.
5. **The 60-minute deploy job** against a first build of Hatchet, CNPG and
   RabbitMQ, on capacity P1 only reads.
6. **Mail addresses appear at once**, because `inbound-mail` is already ON.
   Subaddressing is set in the step right after `pulumi up`. A subaddressed
   delivery in the minutes before it may be refused (**unverified**).
7. **No alerting on Hatchet or RabbitMQ**, no backup of `background-work-pg`,
   and the app archive is still in the cluster.
8. **Legal and comms** (P6).

## Open owner decisions

1. What offices are told, and when: subprocessors, the rename, personal memory,
   the Outlook import change, mail for all, the short law window.
2. Personal memory as it is, or hold `memory-reflection` until erasure exists.
3. Whether `ingest-worker-heavy` goes on with this promotion (it never ran on
   staging).
4. `mcpGatewayEnabled` on prod, once the WorkOS Production resource indicator
   and the JWT `roles` claim are confirmed ([platform-mcp-gateway.md](platform-mcp-gateway.md)).
5. `posthogTracesEnabled` and `geocoderUrl` on prod.
6. Afterwards: delete the retired WorkOS flags (listed in P3, plus
   `source-routing` and `project-mail-inbox`). Set an off-cluster bucket for
   `pgBackup*` and `backgroundWorkPgBackup*` together. Agree a fixed promotion
   cadence.

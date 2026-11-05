# Rolling back a deploy

The one procedure for putting staging or production back on the build it ran
before. Why it works this way: [cd.md, "Rolling back"](cd.md#rolling-back).

## When

- A deploy's **Smoke check** step is red. The deploy is live: the app did not
  answer `/api/healthz` or `/api/health` through the ingress after it rolled out.
- The smoke check passed, but something people use broke with the deploy
  (PostHog's `deploy <env> <sha>` annotation dates it against errors).

Roll back first, debug second. A rollback is a deploy of images CI already
passed, through the same gates, and it takes about as long as a deploy.

## The command

Every deploy's job summary has a **Rolling back** section with the tag the stack
ran before that run, as a ready command. Copy it. Without it, the tag is
`sha-` and the full sha of any `develop` commit whose CI push run passed.

Staging:

```bash
gh workflow run deploy.yml --ref develop -f target=staging -f imageTag=sha-<40-hex>
```

Production (the `production` environment's reviewers approve it, like any prod
deploy):

```bash
gh workflow run deploy.yml --ref develop -f target=prod -f imageTag=sha-<40-hex>
```

Or in the browser: Actions, **Deploy (staging)**, *Run workflow*, branch
`develop`, with `target` and `imageTag` filled in.

What happens: GHCR is checked for all three images at that tag, the vector-store
floor is checked, the plan is validated (CRD schemas, policy pack), the rollout
runs with the usual surge and readiness soak, and the smoke check runs again.

## After a production rollback

A production rollback holds until the next push to `prod`, which applies the tag
`Pulumi.prod.yaml` pins, so that push would roll the broken build out again.
Open a PR to `prod` that pins either the rollback tag or a fixed build, the same
way a promotion does. Until it merges, do not push anything else to `prod`.

Staging needs no follow-up: the next green `develop` commit deploys over it. The
downgrade guard lets only an operator's tag move a service to an older commit,
so the automatic deploy of a commit older than the rollback cannot happen.

## What a rollback cannot undo

A rollback changes the **images**. It keeps the current **program** (what
`deploy/pulumi` deploys) and the data.

- **Database migrations stay applied.** The migration Job
  (`deploy/pulumi/src/app/migrations-job.ts`) runs `drizzle-kit migrate` from
  the frontend image, forward only; the older image finds nothing to apply, and
  the older build runs on the newer schema. That is safe while migrations only
  add (columns with defaults, tables, indexes, compatibility views); one that
  drops or renames something the older build reads breaks it. A pull request
  adding such a migration fails Repo checks (`ci/migration_contract.py`) unless
  it carries the `migration:contract` label, so before rolling back across a
  range, look for merged PRs with that label in it. 0189 is the expand half
  done right: it renamed three tables and kept each old name as a view for a
  release, so a build from before it still runs until the contract migration
  drops the views.
- **The program is not rolled back.** For a fault in `deploy/pulumi` itself,
  revert the change on `develop` (staging) or in a PR to `prod`.
- **The vector-store floor refuses some tags.** A backend from before the Chroma
  removal (ADR-0115) cannot run under today's program, and the deploy says so.
  The way back across it: [qdrant-runbook.md, "Rollback"](qdrant-runbook.md#rollback).
- **The data tier is never replaced.** `protectDataResources` (on in prod) makes
  Pulumi refuse to delete or replace Postgres and the storage StatefulSets.

## Drill

Roll staging back to the commit before develop's head once after any change to
`deploy.yml`, then let the next merge deploy over it. Both runs should be green,
the first with "rolling back" in its log and the second with the newer tag.

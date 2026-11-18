# Expand before switch

A stored name or shape that changes in place ships in releases, in this order:

1. **Expand.** Readers accept the old and the new form, and writers keep the old one.
2. **Switch.** Writers write the new form, and a backfill rewrites what is stored
   ([`backfills.md`](backfills.md)).
3. **Contract.** The old form goes.

The switch must not reach prod in the same promotion as its expand. If it did,
the migrate Job and the first new pods would write the new form while old pods,
which cannot read it, are still rolling. A rollback by image tag would land on
the same gap. CI and the promotion workflow enforce the order, so nobody has to
read pull request bodies for it.

## Declare it

The expand's pull request adds `deploy/rollout/expands/<name>.json`. Line 1
carries the expiry marker, which `check_legacy_expiry` reads:

```json
{"expires": "drop after release 2026-W50",
  "what": "ADR-0182 phase 4, deploy 1: readers take both spellings"
}
```

The expand counts as shipped from the commit that added the file. An expand that
merged before it was registered names its own commit on develop in `"commit"`,
as `brand-free-stored-names.json` does for #1758.

The switch's pull request adds `deploy/rollout/switches/<name>.json`, naming the
expand:

```json
{"expires": "drop after release 2026-W50",
  "switches": "brand-free-stored-names"
}
```

The contract deletes both files along with the legacy readers.

## What checks it

[`ci/expand_switch.py`](../../ci/expand_switch.py) reads what prod runs from
the `prod` branch: the `sha-<commit>` `imageTag` in `deploy/pulumi/Pulumi.prod.yaml`.
An expand is on prod when its commit is an ancestor of that commit.

| Where | What fails |
|---|---|
| A pull request's **Repo checks** job (`ci.yml`, step "A switch merges only once prod runs its expand") | A switch the pull request adds or changes whose expand prod does not run yet. Once the promotion that carries the expand is live, re-run the job. A pull request that adds no switch skips the check. |
| **Promote to prod** (`promote.yml`, step "Refuse a switch whose expand prod does not run yet") | A promotion of a develop commit that holds any switch whose expand prod does not run yet. Promote an earlier commit that has the expand without the switch, or promote again once that one is live. |

A switch that names no registered expand fails both checks.

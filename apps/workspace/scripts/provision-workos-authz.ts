/**
 * Apply GRID's authorization catalog to a WorkOS environment — or fail on drift.
 *
 * The catalog (`bff/authz/catalog.ts`) is the single source of truth the app
 * derives its permission types from. This script makes WorkOS agree with it, and
 * `--check` makes CI fail when it stops agreeing.
 *
 * That gap was real and it shipped: `org:audit:view` and `org:archiv:manage`
 * lived in the app's registry and in the runbook for three weeks while existing
 * in no WorkOS environment. No custom role could hold them, so the documented
 * "create a role with a subset of permissions" contract silently did not work
 * for those two — and nothing anywhere reported it.
 *
 *   Usage:
 *     WORKOS_API_KEY=sk_… npm run provision:authz          # check (read-only)
 *     WORKOS_API_KEY=sk_… npm run provision:authz -- --apply
 *
 * `--check` is the default and never writes. Run it in CI.
 *
 * Every deploy runs `--apply` against its own environment, bundled to plain ESM
 * by the image build: the Kubernetes Job `grid-app-authz-catalog`
 * (`deploy/pulumi/src/app/workos-authz-jobs.ts`) and the compose service
 * `workos-authz`. So it deletes no role, and no permission except one the
 * retired list names (`bff/authz/retired-permissions.ts`): that one is taken off
 * every role holding it and deleted, which is how removing a permission from
 * the catalog reaches an environment. Roles outside the catalog (an office's
 * custom roles) are otherwise left alone.
 *
 * Any drift exits 1, under `--apply` too: a slug in one of our namespaces that
 * is in WorkOS and neither in the catalog nor retired fails the Job. The logic
 * is in `provision-workos-authz-reconcile.ts`, where a spec runs it.
 *
 * ## What this script does NOT do
 *
 * Resource types (Organization → Project → Skill) are not exposed by the
 * Node SDK, so they are a dashboard step — documented in
 * `docs/deployment/workos-provisioning.md`. The script still VERIFIES them
 * indirectly: a permission cannot be created against a resource type that does
 * not exist, so a missing type surfaces as a create failure naming the type.
 */

import { WorkOS } from '@workos-inc/node'
import { RESOURCE_TYPES } from '../bff/authz/catalog'
import { exitCodeFor, reconcileAuthzCatalog } from './provision-workos-authz-reconcile'

const PLATFORM_ORG_EXTERNAL_ID = process.env.PLATFORM_ORG_EXTERNAL_ID ?? 'grid-platform'

const apply = process.argv.includes('--apply')
const apiKey = process.env.WORKOS_API_KEY
if (!apiKey) {
  console.error('WORKOS_API_KEY is required.')
  process.exit(2)
}
const workos = new WorkOS(apiKey)

async function main(): Promise<void> {
  console.log(`GRID authorization catalog → WorkOS (${apply ? 'APPLY' : 'CHECK — read-only'})`)
  console.log(
    `\nExpected resource topology (dashboard-managed, not creatable via the SDK):\n  ` +
      RESOURCE_TYPES.map(
        (type) => `${type.slug}${type.parent ? ` → parent ${type.parent}` : ' (root)'}`
      ).join('\n  ')
  )

  const result = await reconcileAuthzCatalog(workos, {
    apply,
    platformOrgExternalId: PLATFORM_ORG_EXTERNAL_ID,
    note: (message) => console.log(message),
  })

  if (apply) {
    console.log(`\nApplied ${result.applied.length} change(s).`)
    for (const change of result.applied) console.log(`  - ${change}`)
  }

  if (result.drift.length === 0) {
    console.log('\nWorkOS matches the catalog.')
    return
  }

  console.error(`\n${result.drift.length} drift finding(s):`)
  for (const finding of result.drift) console.error(`  - ${finding}`)
  console.error(
    apply
      ? '\nSome changes could not be applied — see above.'
      : '\nRun with --apply to reconcile (resource types must be created in the dashboard first).'
  )
  process.exit(exitCodeFor(result))
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})

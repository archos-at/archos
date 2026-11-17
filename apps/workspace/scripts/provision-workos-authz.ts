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

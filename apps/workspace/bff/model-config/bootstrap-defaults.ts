import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { recordAuditEvent } from '@/lib/audit/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { AGENT_GROUPS } from './agent-groups'
import { getWorkflowLlmBaseUrls, type LlmBaseUrls } from './backend-defaults'
import { fetchModelCatalog, fetchZdrEndpoints, validateOverrides, type ZdrIndex } from './openrouter'
import { getPlatformModelDefaults, savePlatformModelDefaults } from './platform-defaults'

export const BOOTSTRAP_DEFAULT_MODEL = 'openai/gpt-6-luna'

export const BOOTSTRAP_ACTOR = 'system:bootstrap'

const BOOTSTRAP_NOTE = 'Initial platform default, set on first boot — change under Platform → Models.'

const BOOTSTRAP_LOCK_KEY = 4_130_026

function targetsPlatformProvider(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

export function groupsEligibleForBootstrap(baseUrls: LlmBaseUrls): string[] {
  return AGENT_GROUPS.filter((group) => {
    const refs = group.configLlmRefs.filter((ref) => ref in baseUrls)
    if (refs.length !== group.configLlmRefs.length) return false
    return refs.every((ref) => targetsPlatformProvider(baseUrls[ref]))
  }).map((group) => group.id)
}

export async function bootstrapPlatformModelDefaults(): Promise<string[]> {
  if (!process.env.APP_DATABASE_URL) {
    console.debug('[Model Config] Skipping default bootstrap: no application database configured')
    return []
  }
  try {
    return await runBootstrap()
  } catch (error) {
    console.error('[Model Config] Platform default bootstrap failed:', error)
    return []
  }
}

async function runBootstrap(): Promise<string[]> {
  if (Object.keys(await getPlatformModelDefaults()).length > 0) return []

  let baseUrls: LlmBaseUrls
  try {
    baseUrls = await getWorkflowLlmBaseUrls()
  } catch (error) {
    console.warn(
      '[Model Config] Skipping default bootstrap: could not read the backend workflow config:',
      error
    )
    return []
  }

  const eligible = groupsEligibleForBootstrap(baseUrls)
  const skipped = AGENT_GROUPS.map((group) => group.id).filter((id) => !eligible.includes(id))
  if (eligible.length === 0) {
    console.warn(
      '[Model Config] Skipping default bootstrap: no agent group runs on the platform model provider'
    )
    return []
  }
  if (skipped.length > 0) {
    console.warn(
      `[Model Config] Bootstrapping platform defaults for ${eligible.join(', ')}; leaving ${skipped.join(', ')} on the deployment's own configuration`
    )
  }

  const defaults = Object.fromEntries(eligible.map((id) => [id, BOOTSTRAP_DEFAULT_MODEL]))

  let catalog
  let zdr: ZdrIndex
  try {
    ;[catalog, zdr] = await Promise.all([fetchModelCatalog(), fetchZdrEndpoints()])
  } catch (error) {
    console.warn(
      '[Model Config] Skipping default bootstrap: the model catalog or the zero-data-retention list is unavailable:',
      error
    )
    return []
  }
  const validation = validateOverrides(catalog, defaults, true, zdr)
  if (!validation.ok) {
    const zdrRefused = Object.values(validation.errors)
      .flat()
      .some((rejection) => rejection.code === 'not_zdr' || rejection.code === 'zdr_endpoint_lacks_capability')
    console.error(
      zdrRefused
        ? `[Model Config] Skipping default bootstrap: ${BOOTSTRAP_DEFAULT_MODEL} has no zero-data-retention endpoint that serves every group; organizations are ZDR by default, so it cannot be the fleet default. Pick a ZDR model under Platform → Models.`
        : `[Model Config] Skipping default bootstrap: ${BOOTSTRAP_DEFAULT_MODEL} failed validation:`,
      validation.errors
    )
    return []
  }
  const written = await withPlatformAccess(
    'first-boot bootstrap of the platform-wide model defaults, which belong to no tenant',
    () =>
      getDb().transaction(async (tx) => {
    const lockRows = Array.from(
      await tx.execute<{ locked: boolean }>(
        // Transaction-scoped on purpose: a session lock on a pooled connection can be released on another and then never, so every later boot would skip provisioning.
        sql`SELECT pg_try_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY}) AS locked`
      )
    )
    if (!lockRows[0]?.locked) {
      console.warn('[Model Config] Skipping default bootstrap: another replica holds the lock')
      return []
    }

    const countRows = Array.from(
      await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM platform_model_defaults`
      )
    )
    if (Number(countRows[0]?.count ?? 0) > 0) return []

    await savePlatformModelDefaults(
      {
        defaults,
        modelSnapshot: validation.snapshot,
        note: BOOTSTRAP_NOTE,
        actorUserId: BOOTSTRAP_ACTOR,
        actorEmail: null,
      },
      tx
    )
        return eligible
      }),
  )

  if (written.length === 0) return []

  try {
    const platformOrgId = await getPlatformOrganizationId()
    if (platformOrgId) {
      await recordAuditEvent({
        organizationId: platformOrgId,
        actor: { userId: BOOTSTRAP_ACTOR, email: null },
        action: 'platform.model_defaults.bootstrapped',
        targetType: 'platform_model_defaults',
        targetId: 'platform',
        metadata: defaults,
      })
    } else {
      console.error(
        '[Model Config] Bootstrapped fleet defaults without an audit event: the platform organization did not resolve'
      )
    }
  } catch (error) {
    console.error('[Model Config] Could not audit the platform default bootstrap:', error)
  }

  console.warn(
    `[Model Config] Bootstrapped platform default ${BOOTSTRAP_DEFAULT_MODEL} for: ${written.join(', ')}`
  )
  return written
}

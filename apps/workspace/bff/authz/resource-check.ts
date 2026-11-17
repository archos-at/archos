import 'server-only'
import { randomUUID } from 'node:crypto'
import { getCached, setCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'
import { timedWorkOSCall } from '@/lib/workos/instrumentation'

export interface ResourceCheckInput {
  readonly organizationMembershipId: string
  readonly organizationId?: string | null
  readonly resourceExternalId: string
  readonly resourceTypeSlug: 'project' | 'folder'
}

export const DEFAULT_AUTHZ_CACHE_TTL_MS = 30_000

export function authzCacheTtlMs(): number {
  const raw = process.env.AUTHZ_CACHE_TTL_MS
  if (raw === undefined || raw === '') return DEFAULT_AUTHZ_CACHE_TTL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const GRANTS_GENERATION_TTL_MS = 24 * 60 * 60 * 1000

const grantsGenerationKey = (organizationId: string | null | undefined, organizationMembershipId: string) =>
  `authz:grants-generation:${organizationId ?? 'no-org'}:${organizationMembershipId}`

async function grantsGeneration(
  organizationId: string | null | undefined,
  organizationMembershipId: string
): Promise<string> {
  return getCached(grantsGenerationKey(organizationId, organizationMembershipId), GRANTS_GENERATION_TTL_MS, async () =>
    randomUUID()
  )
}

export async function forgetResourceGrants(
  organizationId: string | null | undefined,
  organizationMembershipId: string
): Promise<void> {
  await setCached(
    grantsGenerationKey(organizationId, organizationMembershipId),
    randomUUID(),
    GRANTS_GENERATION_TTL_MS
  )
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

export async function effectiveResourcePermissions(
  input: ResourceCheckInput,
  options: { strict?: boolean } = {}
): Promise<ReadonlySet<string>> {
  const { organizationMembershipId, organizationId, resourceExternalId, resourceTypeSlug } = input

  const load = () =>
    timedWorkOSCall(`authorization.listEffectivePermissions ${resourceTypeSlug}`, async () => {
      try {
        const page = await getWorkOS().authorization.listEffectivePermissionsByExternalId({
          organizationMembershipId,
          resourceTypeSlug,
          externalId: resourceExternalId,
        })
        return (await page.autoPagination()).map((permission) => permission.slug)
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
    })

  const ttlMs = authzCacheTtlMs()
  try {
    if (ttlMs <= 0) return new Set(await load())
    const generation = await grantsGeneration(organizationId, organizationMembershipId)
    const slugs = await getCached(
      `authz:effective:${organizationId ?? 'no-org'}:${organizationMembershipId}:${generation}:${resourceTypeSlug}:${resourceExternalId}`,
      ttlMs,
      load
    )
    return new Set(slugs)
  } catch (error) {
    if (options.strict) throw error
    console.warn(`[authz] effective permissions failed on ${resourceTypeSlug}:${resourceExternalId}:`, error)
    return new Set()
  }
}

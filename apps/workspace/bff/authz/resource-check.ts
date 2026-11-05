/**
 * The one WorkOS FGA round-trip, shared by every resource tier (ADR-0038).
 *
 * Every per-resource answer is ONE call, {@link effectiveResourcePermissions}:
 * everything a membership holds on a resource, cached under one key, so the
 * project gate, the project listing and the folder clearance read the same
 * entry and cannot disagree about what someone holds.
 *
 * **Fails closed**: any transport or SDK error resolves to an empty set. An
 * authorization check that cannot complete is a denial, never a default-allow.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { getCached, setCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'
import { timedWorkOSCall } from '@/lib/workos/instrumentation'

export interface ResourceCheckInput {
  /** The (user, organization) identity WorkOS resolves roles against. */
  readonly organizationMembershipId: string
  /**
   * The caller's organization. Part of the cache key (never omitted — absent
   * renders as the literal `no-org` segment), so a verdict cached for one
   * tenant is never served to another.
   */
  readonly organizationId?: string | null
  readonly resourceExternalId: string
  readonly resourceTypeSlug: 'project' | 'folder'
}

/**
 * Short-TTL cache of WorkOS FGA answers ({@link effectiveResourcePermissions}).
 *
 * `AUTHZ_CACHE_TTL_MS` (default `30000`; `0` switches it OFF) caches what a
 * membership holds on one resource. On by default since 2026-09: the
 * websocket-scope route and every project save paid up to three WorkOS
 * round-trips per request for a grant that changes a few times a year.
 *
 * A grant or revocation made IN the product is seen at once: every change of a
 * membership's resource roles starts a new generation of that membership's
 * cached answers ({@link forgetResourceGrants}), and every answer is filed under
 * the generation current when it was read. A read in flight while the roles
 * changed lands under the old generation, where nothing reads it again, so a
 * person taken off a project cannot be cached back onto it. Only a change made
 * outside the product (the WorkOS dashboard, a directory sync) waits out the TTL.
 *
 * Tenancy is enforced IN the key, not around it: the key shape is
 * `authz:effective:{org}:{membership}:{generation}:{type}:{id}`, with the
 * literal segment `no-org` when the caller has no organization. A resource can
 * never be served across-org from cache, and tenancy itself is still checked on
 * every request against Postgres before this cache is consulted.
 *
 * Error-induced denials are NEVER cached: only completed WorkOS answers
 * populate an entry. Org admins bypass FGA before this cache is consulted.
 */
export const DEFAULT_AUTHZ_CACHE_TTL_MS = 30_000

export function authzCacheTtlMs(): number {
  const raw = process.env.AUTHZ_CACHE_TTL_MS
  if (raw === undefined || raw === '') return DEFAULT_AUTHZ_CACHE_TTL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * How long a membership's grants generation is kept. Far longer than any
 * answer filed under it; if the store evicts it anyway, the next read starts a
 * new generation, which only makes every cached answer unreachable.
 */
const GRANTS_GENERATION_TTL_MS = 24 * 60 * 60 * 1000

const grantsGenerationKey = (organizationId: string | null | undefined, organizationMembershipId: string) =>
  `authz:grants-generation:${organizationId ?? 'no-org'}:${organizationMembershipId}`

/** The current generation of a membership's cached resource answers. */
async function grantsGeneration(
  organizationId: string | null | undefined,
  organizationMembershipId: string
): Promise<string> {
  return getCached(grantsGenerationKey(organizationId, organizationMembershipId), GRANTS_GENERATION_TTL_MS, async () =>
    randomUUID()
  )
}

/**
 * Makes every cached resource answer of one membership unreachable. Run after
 * every change of that membership's roles on a resource, failed or not: a
 * change that got part-way changed something.
 */
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

/**
 * Every permission a membership holds on one resource, in ONE WorkOS call:
 * `listEffectivePermissionsByExternalId`, which counts roles assigned on the
 * resource and on its ancestors. A caller that needs several answers about one
 * resource asks once.
 *
 * Cached under a key with the organization and the membership's grants
 * generation in it. A resource WorkOS has never heard of (404) holds nothing,
 * and that answer is cached; any other failure grants nothing and is not cached.
 */
export async function effectiveResourcePermissions(
  input: ResourceCheckInput,
  /** `strict`: a failed lookup throws instead of holding nothing, for a caller that waits a fault out (the receive job). */
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

import 'server-only'

import { getPosthogServer, serverEventIdentity } from '@/lib/analytics/posthog-server'
import type { MissingTenantContextError } from '@/lib/db/tenant-context'

const OUTSIDE_SLOT: MissingTenantContextError['name'] = 'MissingTenantContextError'

export function isOutsideTenantSlot(error: unknown): error is MissingTenantContextError {
  return error instanceof Error && error.name === OUTSIDE_SLOT
}

function reportOutsideSlot(what: string, error: MissingTenantContextError): void {
  console.error(`[best-effort] ${what} ran outside a tenant slot, a bug and not a passing failure:`, error)
  const posthog = getPosthogServer()
  if (!posthog) return
  const identity = serverEventIdentity(undefined, undefined)
  posthog.captureException(error, identity.distinctId, { ...identity.properties, source: 'bff-best-effort', what })
}

export async function bestEffort<T>(what: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    if (isOutsideTenantSlot(error)) throw error
    console.warn(`[best-effort] ${what} failed:`, error)
    return null
  }
}

export function bestEffortInBackground(what: string, work: () => Promise<unknown>): void {
  const fail = (error: unknown) => {
    if (isOutsideTenantSlot(error)) reportOutsideSlot(what, error)
    else console.warn(`[best-effort] ${what} failed:`, error)
  }
  try {
    void Promise.resolve(work()).catch(fail)
  } catch (error) {
    fail(error)
  }
}

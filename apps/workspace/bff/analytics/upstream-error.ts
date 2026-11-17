import 'server-only'

import type { UpstreamError } from '@/lib/api/errors'

import { getTenantContext } from '@/lib/db/tenant-context'

import { getPosthogServer, serverEventIdentity } from './posthog-server'

export const UPSTREAM_ERROR_BURST = 5
const UPSTREAM_ERROR_WINDOW_MS = 5 * 60_000

let windows = new Map<string, { startedAt: number; count: number }>()

const isRateLimited = (fingerprint: string, now: number): boolean => {
  const window = windows.get(fingerprint)
  if (!window || now - window.startedAt >= UPSTREAM_ERROR_WINDOW_MS) {
    windows.set(fingerprint, { startedAt: now, count: 1 })
    return false
  }
  window.count += 1
  if (window.count === UPSTREAM_ERROR_BURST + 1) {
    console.warn('[posthog] upstream error rate-limited:', fingerprint.slice(0, 160))
  }
  return window.count > UPSTREAM_ERROR_BURST
}

export interface UpstreamContext {
  operation?: string
  code?: string
}

export const upstreamContext = (error: UpstreamError): UpstreamContext => {
  const details = (error.details ?? {}) as { operation?: unknown; code?: unknown }
  return {
    ...(typeof details.operation === 'string' ? { operation: details.operation } : {}),
    ...(typeof details.code === 'string' ? { code: details.code } : {}),
  }
}

export const captureUpstreamError = (error: UpstreamError, requestId: string): boolean => {
  const posthog = getPosthogServer()
  if (!posthog) return false
  const context = upstreamContext(error)
  if (isRateLimited(`${error.message}|${context.code ?? ''}`, Date.now())) return false
  try {
    const scope = getTenantContext()
    const tenant = scope?.kind === 'tenant' ? scope : null
    const identity = serverEventIdentity(tenant?.userId, tenant?.organizationId)
    posthog.captureException(error, identity.distinctId, {
      ...identity.properties,
      source: 'bff-upstream-error',
      request_id: requestId,
      ...context,
    })
    return true
  } catch (failure) {
    console.debug('[posthog] could not queue an upstream error', failure)
    return false
  }
}

export const resetUpstreamErrorLimiterForTests = (): void => {
  windows = new Map()
}

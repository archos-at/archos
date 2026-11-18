import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

export const ORGANIZATION_SETTING = 'app.organization_id'
export const USER_SETTING = 'app.user_id'

export const PLATFORM_ROLE = 'app_platform'

export interface TenantScope {
  readonly kind: 'tenant'
  readonly organizationId: string
  readonly userId: string | null
}

export interface PlatformScope {
  readonly kind: 'platform'
  readonly reason: string
}

export type TenantContext = TenantScope | PlatformScope

interface TenantSlot {
  scope: TenantContext | null
}

const storage = new AsyncLocalStorage<TenantSlot>()

export class MissingTenantContextError extends Error {
  readonly code = 'MISSING_TENANT_CONTEXT'

  constructor() {
    super(
      'Database access outside a tenant context. Every query must run inside ' +
        'withTenant() or withPlatformAccess() — see lib/db/tenant-context.ts. ' +
        'Authenticated requests get this from getUserSession(); background and ' +
        'internal callers must state it.'
    )
    this.name = 'MissingTenantContextError'
  }
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore()?.scope ?? undefined
}

export function requireTenantContext(): TenantContext {
  const context = getTenantContext()
  if (!context) throw new MissingTenantContextError()
  return context
}

export function runWithTenantSlot<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  return storage.run({ scope: null }, async () => await fn())
}

export function tenantSlotRoute<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>
): (...args: TArgs) => Promise<Response> {
  return (...args: TArgs) => runWithTenantSlot(() => handler(...args))
}

export function enterTenantContext(session: {
  organizationId: string | null
  userId: string
}): void {
  const scope: TenantContext | null = session.organizationId
    ? { kind: 'tenant', organizationId: session.organizationId, userId: session.userId }
    : null

  const slot = storage.getStore()
  if (slot) {
    slot.scope = scope
    return
  }
  storage.enterWith({ scope })
}

export function clearTenantContext(): void {
  enterTenantContext({ organizationId: null, userId: '' })
}

export function withTenant<T>(
  scope: { organizationId: string; userId?: string | null },
  fn: () => PromiseLike<T> | T
): Promise<T> {
  return storage.run(
    { scope: { kind: 'tenant', organizationId: scope.organizationId, userId: scope.userId ?? null } },
    async () => await fn()
  )
}

export function withPlatformAccess<T>(reason: string, fn: () => PromiseLike<T> | T): Promise<T> {
  return storage.run({ scope: { kind: 'platform', reason } }, async () => await fn())
}

export function withOptionalTenant<T>(
  organizationId: string | null | undefined,
  reasonWhenAbsent: string,
  fn: () => PromiseLike<T> | T
): Promise<T> {
  return organizationId
    ? withTenant({ organizationId }, fn)
    : withPlatformAccess(reasonWhenAbsent, fn)
}

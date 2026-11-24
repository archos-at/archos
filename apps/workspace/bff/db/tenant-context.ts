import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

export const ORGANIZATION_SETTING = 'app.organization_id'
export const USER_SETTING = 'app.user_id'
export const SYSTEM_READER_SETTING = 'app.system_reader'

export const SYSTEM_READERS = {
  ingestion: 'the backend reads, renders and settles a document it is ingesting, for no reader',
  rendition: 'a document is rendered or extracted for its preview, for no reader',
  'search-projection': 'what a document is, projected into its search row, for no reader',
  'document-notices': 'a new Fassung, a check or a due mark is told to the people who may read the document',
} as const

export type SystemReader = keyof typeof SYSTEM_READERS

export const PLATFORM_ROLE = 'app_platform'

export interface TenantScope {
  readonly kind: 'tenant'
  readonly organizationId: string
  readonly userId: string | null
  readonly systemReader?: SystemReader
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

function tenantOf(organizationId: string): TenantScope | null {
  const current = getTenantContext()
  return current?.kind === 'tenant' && current.organizationId === organizationId ? current : null
}

function personOfTenant(organizationId: string): string | null {
  return tenantOf(organizationId)?.userId ?? null
}

export function withTenant<T>(
  scope: { organizationId: string; userId?: string | null },
  fn: () => PromiseLike<T> | T
): Promise<T> {
  const enclosing = scope.userId ? null : tenantOf(scope.organizationId)
  const next: TenantScope = enclosing ?? { kind: 'tenant', organizationId: scope.organizationId, userId: scope.userId ?? null }
  return storage.run({ scope: next }, async () => await fn())
}

export function withSystemReader<T>(
  organizationId: string,
  reader: SystemReader,
  fn: () => PromiseLike<T> | T
): Promise<T> {
  const userId = personOfTenant(organizationId)
  const scope: TenantScope = userId
    ? { kind: 'tenant', organizationId, userId }
    : { kind: 'tenant', organizationId, userId: null, systemReader: reader }
  return storage.run({ scope }, async () => await fn())
}

export function withOptionalSystemReader<T>(
  organizationId: string | null | undefined,
  reader: SystemReader,
  reasonWhenAbsent: string,
  fn: () => PromiseLike<T> | T
): Promise<T> {
  return organizationId ? withSystemReader(organizationId, reader, fn) : withPlatformAccess(reasonWhenAbsent, fn)
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

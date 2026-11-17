import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export interface BudgetSnapshot {
  remainingOrgUsd: number | null
  remainingUserUsd: number | null
  remainingProjectUsd: number | null
  remainingOrgTokens?: number | null
  remainingUserTokens?: number | null
  remainingProjectTokens?: number | null
}

export interface RequestContextInput {
  organizationId?: string | null
  userId?: string | null
  projectId?: string | null
  collectionScope?: ReadonlyArray<string | ScopedCollection> | null
  projectContext?: string | null
  projectMemory?: string | null
  orgInstructions?: string | null
  modelOverrides?: Record<string, string> | null
  budget?: BudgetSnapshot | null
  disabledSources?: string[] | null
  memoryReflectionEnabled?: boolean
  federalState?: string | null
  conversationId?: string | null
  issuedAt?: number | null
  contextTransport?: 'bff'
  requester?: RequestPerson | null
}

export interface RequestPerson {
  name: string | null
  email: string | null
  organizationName: string | null
}

export function requesterOf(
  session: { name?: string | null; email?: string | null; organizationName?: string | null } | null | undefined,
): RequestPerson | null {
  const requester = {
    name: session?.name?.trim() || null,
    email: session?.email?.trim() || null,
    organizationName: session?.organizationName?.trim() || null,
  }
  return requester.name || requester.email || requester.organizationName ? requester : null
}

export const REQUEST_CONTEXT_HEADER_NAMES = {
  ORGANIZATION_ID: 'X-Organization-Id',
  USER_ID: 'X-User-Id',
  PROJECT_ID: 'X-Project-Id',
  COLLECTION_SCOPE: 'X-Collection-Scope',
  PROJECT_CONTEXT: 'X-Project-Context',
  PROJECT_MEMORY: 'X-Project-Memory',
  ORG_INSTRUCTIONS: 'X-Org-Instructions',
  MODEL_OVERRIDES: 'X-Model-Overrides',
  BUDGET: 'X-Budget',
  DISABLED_SOURCES: 'X-Disabled-Sources',
  MEMORY_REFLECTION: 'X-Feature-Memory-Reflection',
  REQUEST_CONTEXT: 'X-Request-Context',
  REQUEST_CONTEXT_SIG: 'X-Request-Context-Sig',
} as const

export function encodeJsonHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function encodeTextHeader(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

export function encodeModelOverridesHeader(overrides: Record<string, string>): string {
  return encodeJsonHeader(overrides)
}

export function encodeBudgetHeader(snapshot: BudgetSnapshot): string {
  return encodeJsonHeader(snapshot)
}

export function buildRequestContextHeaders(input: RequestContextInput): Record<string, string> {
  const headers: Record<string, string> = {}

  if (input.organizationId) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.ORGANIZATION_ID] = input.organizationId
  }
  if (input.userId) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.USER_ID] = input.userId
  }
  if (input.projectId) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.PROJECT_ID] = input.projectId
  }
  if (input.collectionScope && input.collectionScope.length > 0) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.COLLECTION_SCOPE] = encodeJsonHeader(input.collectionScope)
  }
  if (input.contextTransport !== 'bff' && input.projectContext) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.PROJECT_CONTEXT] = encodeTextHeader(input.projectContext)
  }
  if (input.contextTransport !== 'bff' && input.projectMemory) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.PROJECT_MEMORY] = encodeTextHeader(input.projectMemory)
  }
  if (input.contextTransport !== 'bff' && input.orgInstructions) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.ORG_INSTRUCTIONS] = encodeTextHeader(input.orgInstructions)
  }
  if (input.modelOverrides && Object.keys(input.modelOverrides).length > 0) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.MODEL_OVERRIDES] = encodeModelOverridesHeader(input.modelOverrides)
  }
  if (input.budget) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.BUDGET] = encodeBudgetHeader(input.budget)
  }
  if (input.disabledSources && input.disabledSources.length > 0) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.DISABLED_SOURCES] = encodeJsonHeader(input.disabledSources)
  }
  if (input.memoryReflectionEnabled !== undefined) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.MEMORY_REFLECTION] = input.memoryReflectionEnabled ? 'true' : 'false'
  }

  return headers
}

export interface RequestContextEnvelope {
  header: string
  signature: string | null
}

export function buildRequestContextEnvelopePayload(input: RequestContextInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (input.organizationId) {
    payload.organizationId = input.organizationId
  }
  if (input.userId) {
    payload.userId = input.userId
  }
  if (input.projectId) {
    payload.projectId = input.projectId
  }
  if (input.collectionScope && input.collectionScope.length > 0) {
    payload.collectionScope = input.collectionScope
  }
  if (input.contextTransport !== 'bff' && input.projectContext) {
    payload.projectContext = input.projectContext
  }
  if (input.contextTransport !== 'bff' && input.projectMemory) {
    payload.projectMemory = input.projectMemory
  }
  if (input.modelOverrides && Object.keys(input.modelOverrides).length > 0) {
    payload.modelOverrides = input.modelOverrides
  }
  if (input.budget) {
    payload.budget = input.budget
  }
  if (input.disabledSources && input.disabledSources.length > 0) {
    payload.disabledSources = input.disabledSources
  }
  if (input.memoryReflectionEnabled !== undefined) {
    payload.memoryReflectionEnabled = input.memoryReflectionEnabled
  }
  if (input.federalState) {
    payload.federalState = input.federalState
  }
  if (input.conversationId) {
    payload.conversationId = input.conversationId
  }
  if (input.issuedAt !== undefined && input.issuedAt !== null) {
    payload.issuedAt = input.issuedAt
  }
  if (input.contextTransport !== 'bff' && input.orgInstructions) {
    payload.orgInstructions = input.orgInstructions
  }
  if (input.contextTransport) {
    payload.contextTransport = input.contextTransport
  }
  const requester = requesterOf(input.requester)
  if (requester) {
    payload.requester = requester
  }

  return payload
}

export function signRequestContextEnvelope(json: string, secret: string): string {
  return createHmac('sha256', secret).update(json, 'utf8').digest('hex')
}

export function buildRequestContextEnvelope(
  input: RequestContextInput,
  secret: string | null | undefined,
): RequestContextEnvelope {
  const json = JSON.stringify(buildRequestContextEnvelopePayload(input))
  const header = Buffer.from(json, 'utf8').toString('base64url')
  const signature = secret ? signRequestContextEnvelope(json, secret) : null
  return { header, signature }
}

export function buildRequestContextEnvelopeHeaders(
  input: RequestContextInput,
  secret: string | null | undefined,
): Record<string, string> {
  const { header, signature } = buildRequestContextEnvelope(input, secret)
  const headers: Record<string, string> = {
    [REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]: header,
  }
  if (signature) {
    headers[REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG] = signature
  }
  return headers
}

export function buildRequestContextWireHeaders(
  input: RequestContextInput,
  secret: string | null | undefined,
): Record<string, string> {
  return {
    ...buildRequestContextHeaders(input),
    ...buildRequestContextEnvelopeHeaders(input, secret),
  }
}

export const REQUEST_CONTEXT_MAX_AGE_MS = 6 * 60 * 60 * 1000

export interface VerifiedRequestContext {
  organizationId: string
  userId: string
  projectId: string | null
  conversationId: string | null
  issuedAt: number
  collectionScope: readonly string[]
}

function scopeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry: unknown) => {
      if (typeof entry === 'string') return entry
      if (typeof entry === 'object' && entry !== null && 'collection' in entry) {
        const { collection } = entry
        return typeof collection === 'string' ? collection : null
      }
      return null
    })
    .filter((name): name is string => name !== null && name.length > 0)
}

export function verifyRequestContextEnvelope(
  header: string | null | undefined,
  signature: string | null | undefined,
  secret: string | null | undefined,
  now: number = Date.now(),
): VerifiedRequestContext | null {
  if (!header || !signature || !secret) return null

  let json: string
  try {
    json = Buffer.from(header, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expected = signRequestContextEnvelope(json, secret)
  if (!timingSafeEqualHex(expected, signature)) return null

  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const fields = payload as Record<string, unknown>
  const organizationId = typeof fields.organizationId === 'string' ? fields.organizationId : null
  const userId = typeof fields.userId === 'string' ? fields.userId : null
  const issuedAt = typeof fields.issuedAt === 'number' ? fields.issuedAt : null
  if (!organizationId || !userId || issuedAt === null) return null
  if (!Number.isFinite(issuedAt)) return null
  if (Math.abs(now - issuedAt) > REQUEST_CONTEXT_MAX_AGE_MS) return null

  return {
    organizationId,
    userId,
    projectId: typeof fields.projectId === 'string' ? fields.projectId : null,
    conversationId: typeof fields.conversationId === 'string' ? fields.conversationId : null,
    issuedAt,
    collectionScope: scopeNames(fields.collectionScope),
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

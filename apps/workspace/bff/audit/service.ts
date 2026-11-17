import 'server-only'
import { createHmac } from 'node:crypto'
import { configuredAppOrigin } from '@/lib/app-origin'
import { getWorkOS } from '@/lib/workos/client'
import type { AuthoredRefKind } from '@/lib/documents/document-authors'
import { AUDIT_ACTIONS } from './schemas.mjs'
import { DOCUMENT_NAME_KEYS, type AuditDocumentPlacement, type DocumentNameAction } from './document-names'

export { AUDIT_ACTIONS }
export {
  DOCUMENT_NAME_ACTIONS,
  DOCUMENT_NAME_KEYS,
  UNRESTRICTED_NAME_ACTIONS,
  filedInOf,
  type AuditDocumentPlacement,
  type DocumentNameAction,
} from './document-names'
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditMetadata = Record<string, string | number | boolean>

export type AuditActorType = 'user' | 'agent'

export interface AuditAgentRef {
  kind: AuthoredRefKind
  id: string
}

export type AuditActor =
  | { type?: 'user'; userId: string; email?: string | null }
  | { type: 'agent'; userId: string; email?: string | null; ref: AuditAgentRef }

interface AuditTarget {
  type: string
  id: string
}

interface AuditEventFields {
  organizationId: string
  actor: AuditActor
  targetType: string
  targetId?: string | null
  alsoTargets?: readonly { type: string; id: string | null | undefined }[]
  metadata?: Record<string, string | number | boolean | null | undefined>
  request?: Request
  occurredAt?: Date
  idempotencyKey?: string
}

export type AuditEventInput = AuditEventFields &
  (
    | { action: Exclude<AuditAction, DocumentNameAction>; filedIn?: AuditDocumentPlacement }
    | { action: DocumentNameAction; filedIn: AuditDocumentPlacement }
  )

export const SYSTEM_ACTORS = {
  uploadScreening: 'system:upload_screening',
  memoryJudge: 'system:memory_judge',
  inboundMail: 'system:inbound_mail',
  knowledgeCarry: 'system:knowledge-carry',
} as const

function requestContext(request?: Request): { location: string; userAgent?: string } {
  const forwarded = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const userAgent = request?.headers.get('user-agent') ?? undefined
  return { location: forwarded || 'unknown', userAgent }
}

export function auditLogsEnabled(): boolean {
  return (process.env.AUDIT_LOGS_ENABLED ?? '').trim().toLowerCase() === 'true'
}

function compactMetadata(metadata: AuditEventInput['metadata']): AuditMetadata {
  const entries = Object.entries(metadata ?? {}).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] != null,
  )
  return Object.fromEntries(entries)
}

function eventTargets(input: AuditEventInput): AuditTarget[] {
  const subject: AuditTarget = { type: input.targetType, id: input.targetId ?? input.organizationId }
  const also = (input.alsoTargets ?? []).flatMap((target) => (target.id ? [{ type: target.type, id: target.id }] : []))
  if (input.actor.type !== 'agent') return [subject, ...also]
  return [subject, ...also, { type: input.actor.ref.kind, id: input.actor.ref.id }]
}

export class AuditEmitError extends Error {
  readonly action: AuditAction
  readonly organizationId: string

  constructor(input: AuditEventInput, cause: unknown) {
    super(`failed to emit audit event ${input.action} for org ${input.organizationId}`, { cause })
    this.name = 'AuditEmitError'
    this.action = input.action
    this.organizationId = input.organizationId
  }
}

async function mayNameDocument(organizationId: string, placement: AuditDocumentPlacement | undefined): Promise<boolean> {
  if (!placement || placement.folderId === null) return true
  try {
    const { ANY_MEMBER, isFolderVisibleToClearance } = await import('@/lib/authz/folder-access')
    return await isFolderVisibleToClearance(organizationId, placement.projectId, placement.folderId, ANY_MEMBER)
  } catch (error) {
    console.error(`[Audit] could not decide whether a document in folder ${placement.folderId} may be named:`, error)
    return false
  }
}

export const HASHED_NAME_KEYS: readonly string[] = [...DOCUMENT_NAME_KEYS, 'name', 'collectionName']

export const NAME_HASH_PREFIX = 'hmac-sha256:'

export function nameHash(salt: string, organizationId: string, value: string): string {
  const digest = createHmac('sha256', salt).update(`${organizationId}\u0000${value}`).digest('hex')
  return `${NAME_HASH_PREFIX}${digest.slice(0, 32)}`
}

export function residencyAuditMetadata(organizationId: string, metadata: AuditMetadata): AuditMetadata {
  if (!process.env.RESIDENCY_CELL?.trim()) return metadata
  const salt = process.env.AUDIT_NAME_SALT?.trim()
  const out: AuditMetadata = {}
  let withheld = false
  for (const [key, value] of Object.entries(metadata)) {
    if (!HASHED_NAME_KEYS.includes(key)) {
      out[key] = value
    } else if (salt) {
      out[key] = nameHash(salt, organizationId, String(value))
    } else {
      withheld = true
    }
  }
  return withheld ? { ...out, nameWithheld: true } : out
}

async function wireMetadata(input: AuditEventInput): Promise<AuditMetadata> {
  const metadata = residencyAuditMetadata(input.organizationId, compactMetadata(input.metadata))
  if (await mayNameDocument(input.organizationId, input.filedIn)) return metadata
  const withheld = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !(DOCUMENT_NAME_KEYS as readonly string[]).includes(key))
  )
  return { ...withheld, nameWithheld: true }
}

async function emit(input: AuditEventInput): Promise<void> {
  const metadata = await wireMetadata(input)
  const workos = getWorkOS()
  const options = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
  await workos.auditLogs.createEvent(input.organizationId, {
    action: input.action,
    occurredAt: input.occurredAt ?? new Date(),
    actor: {
      type: 'user',
      id: input.actor.userId,
      name: input.actor.email ?? undefined,
      metadata: {},
    },
    targets: eventTargets(input),
    context: requestContext(input.request),
    metadata,
  }, options)
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  if (!auditLogsEnabled()) return
  try {
    await emit(input)
  } catch (error) {
    console.error(`[Audit] failed to emit ${input.action} for org ${input.organizationId}:`, error)
  }
}

export async function recordAuditEventOrThrow(input: AuditEventInput): Promise<void> {
  if (!auditLogsEnabled()) return
  try {
    await emit(input)
  } catch (error) {
    throw new AuditEmitError(input, error)
  }
}

export function trustedAppOrigin(request: Request): string {
  return configuredAppOrigin() ?? new URL(request.url).origin
}

export async function generateAuditPortalLink(organizationId: string, returnUrl?: string): Promise<string> {
  const workos = getWorkOS()
  const { link } = await workos.adminPortal.generateLink({
    intent: 'audit_logs',
    organization: organizationId,
    returnUrl,
  })
  return link
}

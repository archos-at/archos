import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isAgentWakesEnabled } from '@/lib/authz/feature-flags'
import { recordAuditEvent } from '@/lib/audit/service'
import type { DbTransaction } from '@/lib/db/executor'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, type AgentWakePayload } from '@/lib/jobs-queue/types'
import { countWakes, insertWake } from './wake-repository'
import {
  isLive,
  type AnnotationAuthor,
  type AnnotationKind,
  type AnnotationStatus,
  type AgentWakeTrigger,
  type WakeOutcome,
} from './types'
import { wakeTurnId } from './wake-ids'
import { isAgentKind } from '@/lib/agent-kind'

export const AGENT_WAKE_JOB = 'piloti_wake'

export interface WakeLimits {
  perMarkHour: number
  perPersonDay: number
}

const DEFAULT_LIMITS: WakeLimits = { perMarkHour: 6, perPersonDay: 50 }

const positive = (raw: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function wakeLimits(env: Record<string, string | undefined> = process.env): WakeLimits {
  return {
    perMarkHour: positive(env.WAKE_MAX_PER_MARK_HOUR, DEFAULT_LIMITS.perMarkHour),
    perPersonDay: positive(env.WAKE_MAX_PER_PERSON_DAY, DEFAULT_LIMITS.perPersonDay),
  }
}

export function wakesEnabled(session: Pick<AuthorizedSession, 'featureFlags'>): boolean {
  return isAgentWakesEnabled(session)
}

export function replyTrigger(
  mark: { authorKind: AnnotationAuthor; kind: AnnotationKind; status: AnnotationStatus },
  reply: { authorKind: AnnotationAuthor; addressesPiloti: boolean }
): AgentWakeTrigger | null {
  if (isAgentKind(reply.authorKind)) return null
  if (reply.addressesPiloti) return 'thread_mention'
  if (isAgentKind(mark.authorKind) && mark.kind === 'question' && isLive(mark)) return 'thread_reply'
  return null
}

export interface WakeEvent {
  organizationId: string
  documentId: string
  annotationId: string
  trigger: AgentWakeTrigger
  eventId: string
  actor: { userId: string; email: string | null }
}

export type CapReason = 'cap:mark-hour' | 'cap:person-day'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export async function capReached(
  executor: Parameters<typeof countWakes>[0],
  event: Pick<WakeEvent, 'organizationId' | 'annotationId' | 'actor'>,
  now: Date,
  limits: WakeLimits = wakeLimits(),
  before?: { createdAt: Date; id: string }
): Promise<CapReason | null> {
  const perMark = await countWakes(executor, {
    organizationId: event.organizationId,
    annotationId: event.annotationId,
    since: new Date(now.getTime() - HOUR_MS),
    before,
  })
  if (perMark >= limits.perMarkHour) return 'cap:mark-hour'
  const perPerson = await countWakes(executor, {
    organizationId: event.organizationId,
    actorUserId: event.actor.userId,
    since: new Date(now.getTime() - DAY_MS),
    before,
  })
  return perPerson >= limits.perPersonDay ? 'cap:person-day' : null
}

export type EnqueuedWake = { outcome: 'queued'; wakeId: string } | { outcome: 'suppressed'; wakeId: string; reason: CapReason }

export async function enqueueWake(
  tx: DbTransaction,
  event: WakeEvent,
  { now = new Date(), limits = wakeLimits() }: { now?: Date; limits?: WakeLimits } = {}
): Promise<EnqueuedWake> {
  const wakeId = wakeTurnId(event.eventId)
  const row = {
    id: wakeId,
    organizationId: event.organizationId,
    documentId: event.documentId,
    annotationId: event.annotationId,
    triggerKind: event.trigger,
    eventId: event.eventId,
    actorUserId: event.actor.userId,
  }
  const cap = await capReached(tx, event, now, limits)
  if (cap) {
    await insertWake(tx, { ...row, status: 'suppressed', reason: cap })
    return { outcome: 'suppressed', wakeId, reason: cap }
  }
  if (!(await insertWake(tx, { ...row, status: 'queued' }))) return { outcome: 'queued', wakeId }
  const payload: AgentWakePayload = {
    wakeId,
    trigger: event.trigger,
    eventId: event.eventId,
    documentId: event.documentId,
    annotationId: event.annotationId,
    actor: event.actor,
    waits: 0,
  }
  await enqueueJob(
    {
      kind: AGENT_WAKE_JOB,
      organizationId: event.organizationId,
      payload: { ...payload },
      priority: BFF_JOB_PRIORITY.interactive,
      jobId: wakeId,
    },
    tx
  )
  return { outcome: 'queued', wakeId }
}

export const wakeOutcomeOf = (wake: EnqueuedWake | null): WakeOutcome => (wake ? wake.outcome : 'none')

export function auditSuppressedWake(input: {
  organizationId: string
  actor: { userId: string; email: string | null }
  annotationId: string
  documentId: string
  trigger: AgentWakeTrigger
  status: 'suppressed'
  reason: string
  stage: 'enqueue' | 'claim'
}): void {
  void recordAuditEvent({
    action: 'agent.wake.suppressed',
    organizationId: input.organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email },
    targetType: 'document_annotation',
    targetId: input.annotationId,
    metadata: {
      documentId: input.documentId,
      trigger: input.trigger,
      status: input.status,
      reason: input.reason.slice(0, 200),
      stage: input.stage,
    },
  })
}

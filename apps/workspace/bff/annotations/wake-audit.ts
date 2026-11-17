import 'server-only'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuditEventInput } from '@/lib/audit/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import type { AgentWakeTrigger } from './types'
import { wakeEndReasonKind } from './wake-end-reason'
import { documentThreadConversationId } from './wake-ids'

interface AuditPerson {
  userId: string
  email: string | null
}

async function withEmail(organizationId: string, person: AuditPerson): Promise<AuditPerson> {
  if (person.email) return person
  try {
    const directory = await loadOrganizationDirectory(organizationId)
    return { userId: person.userId, email: directory.get(person.userId)?.email ?? null }
  } catch {
    return { userId: person.userId, email: null }
  }
}

function recordAsPerson(input: AuditEventInput & { actor: AuditPerson }): void {
  if (input.actor.email) {
    recordAuditEventAfterCommit(input)
    return
  }
  void withEmail(input.organizationId, input.actor).then((actor) => recordAuditEventAfterCommit({ ...input, actor }))
}

export interface AuditedWake {
  organizationId: string
  wakeId: string
  documentId: string
  annotationId: string
  trigger: AgentWakeTrigger
  wokenBy: { userId: string; email: string | null }
  projectId: string | null
  markNumber: number | null
}

const wakeTargets = (wake: AuditedWake) => ({
  targetType: 'document_annotation',
  targetId: wake.annotationId,
  alsoTargets: [
    { type: 'document', id: wake.documentId },
    { type: 'project', id: wake.projectId },
    {
      type: 'conversation',
      id: documentThreadConversationId(wake.documentId, wake.wokenBy.userId),
    },
  ],
})

export function auditWakeStarted(wake: AuditedWake, waits: number): void {
  recordAsPerson({
    action: 'piloti.wake.started',
    organizationId: wake.organizationId,
    actor: wake.wokenBy,
    ...wakeTargets(wake),
    metadata: { trigger: wake.trigger, wakeId: wake.wakeId, markNumber: wake.markNumber, waits },
  })
}

export interface AuditedWakeEnd {
  outcome: 'answered' | 'stopped' | 'failed' | 'refused'
  turnOutcome: string | null
  reason: string | null
  handedBack: boolean
}

const REASON_MAX = 200

export function auditWakeEnded(wake: AuditedWake, end: AuditedWakeEnd): void {
  recordAsPerson({
    action: 'piloti.wake.ended',
    organizationId: wake.organizationId,
    actor: wake.wokenBy,
    ...wakeTargets(wake),
    metadata: {
      trigger: wake.trigger,
      wakeId: wake.wakeId,
      outcome: end.outcome,
      turnOutcome: end.turnOutcome,
      reason: end.reason?.trim().slice(0, REASON_MAX) || null,
      reasonKind: wakeEndReasonKind(end.outcome, end.reason),
      handedBack: end.handedBack,
      markNumber: wake.markNumber,
    },
  })
}

export interface WakeStopper {
  userId: string
  email: string | null
  piloti: boolean
}

export function auditWakeStopped(
  wake: AuditedWake,
  wakeStatus: 'queued' | 'started',
  by: WakeStopper
): void {
  recordAsPerson({
    action: 'piloti.wake.stopped',
    organizationId: wake.organizationId,
    actor: { userId: by.userId, email: by.email },
    ...wakeTargets(wake),
    metadata: {
      trigger: wake.trigger,
      wakeId: wake.wakeId,
      wakeStatus,
      wokenBy: wake.wokenBy.userId,
      by: by.piloti ? 'piloti' : 'person',
    },
  })
}

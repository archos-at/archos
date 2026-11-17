import 'server-only'
import type { DbExecutor } from '@/lib/db/executor'
import { getDb } from '@/lib/db'
import type { AgentWakeRow } from '@/lib/db/schema/document-annotations'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, type AgentWakeStopPayload } from '@/lib/jobs-queue/types'
import { withTenant } from '@/lib/db/tenant-context'
import { auditWakeStopped, type WakeStopper } from './wake-audit'
import { delegationEventId } from './wake-ids'
import { findLiveDelegationWake, settleWake } from './wake-repository'

export const AGENT_WAKE_STOP_JOB = 'piloti_wake_stop'

export const TAKEN_BACK = 'taken back'

export interface EndedDelegation {
  organizationId: string
  documentId: string
  annotationId: string
  delegatedAt: Date
}

export interface TakeBack {
  queuedWake: AgentWakeRow | null
  stoppingWake: AgentWakeRow | null
}

export interface TakeBackAudit extends WakeStopper {
  projectId: string | null
  markNumber: number | null
}

const NOTHING: TakeBack = { queuedWake: null, stoppingWake: null }

function auditStopped(wake: AgentWakeRow, status: 'queued' | 'started', by: TakeBackAudit): void {
  auditWakeStopped(
    {
      organizationId: wake.organizationId,
      wakeId: wake.id,
      documentId: wake.documentId,
      annotationId: wake.annotationId,
      trigger: wake.triggerKind,
      wokenBy: { userId: wake.actorUserId, email: null },
      projectId: by.projectId,
      markNumber: by.markNumber,
    },
    status,
    by
  )
}

const stopPayload = (wake: AgentWakeRow): AgentWakeStopPayload => ({
  wakeId: wake.id,
  documentId: wake.documentId,
  annotationId: wake.annotationId,
  actorUserId: wake.actorUserId,
})

function enqueueStop(executor: DbExecutor, organizationId: string, wake: AgentWakeRow): Promise<unknown> {
  return enqueueJob(
    {
      kind: AGENT_WAKE_STOP_JOB,
      organizationId,
      payload: { ...stopPayload(wake) },
      priority: BFF_JOB_PRIORITY.interactive,
    },
    executor
  )
}

export async function readTakeBack(
  tx: DbExecutor,
  delegation: EndedDelegation,
  { stopTurn }: { stopTurn: boolean }
): Promise<TakeBack> {
  const { organizationId, annotationId } = delegation
  const wake = await findLiveDelegationWake(
    tx,
    organizationId,
    annotationId,
    delegationEventId(annotationId, delegation.delegatedAt)
  )
  if (!wake) return NOTHING
  if (wake.status === 'queued') return { queuedWake: wake, stoppingWake: null }
  if (!stopTurn) return NOTHING
  await enqueueStop(tx, organizationId, wake)
  return { queuedWake: null, stoppingWake: wake }
}

export async function settleTakenBack(
  delegation: EndedDelegation,
  takeBack: TakeBack,
  { stopTurn }: { stopTurn: boolean },
  by: TakeBackAudit
): Promise<void> {
  if (takeBack.stoppingWake) auditStopped(takeBack.stoppingWake, 'started', by)
  const queued = takeBack.queuedWake
  if (!queued) return
  const { organizationId, annotationId } = delegation
  if (await settleWake(organizationId, queued.id, { status: 'suppressed', reason: TAKEN_BACK })) {
    auditStopped(queued, 'queued', by)
    return
  }
  if (!stopTurn) return
  await withTenant({ organizationId }, async () => {
    const db = getDb()
    const wake = await findLiveDelegationWake(
      db,
      organizationId,
      annotationId,
      delegationEventId(annotationId, delegation.delegatedAt)
    )
    if (wake?.status !== 'started') return
    await enqueueStop(db, organizationId, wake)
    auditStopped(wake, 'started', by)
  })
}

export function auditDeletedWithMark(takeBack: TakeBack, by: TakeBackAudit): void {
  if (takeBack.queuedWake) auditStopped(takeBack.queuedWake, 'queued', by)
  if (takeBack.stoppingWake) auditStopped(takeBack.stoppingWake, 'started', by)
}

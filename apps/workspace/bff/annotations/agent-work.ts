import 'server-only'
import type { AgentWakeRow } from '@/lib/db/schema/document-annotations'
import { publishToDocumentRoom } from '@/lib/realtime/document-channel'
import type { AgentWorkView } from './types'
import { wakeEndReasonKind } from './wake-end-reason'
import { listLatestWakes } from './wake-repository'
import { PRODUCT_NAME } from '@/lib/brand'

export const FAILED_SHOWN_MS = 6 * 60 * 60 * 1000
export const HELD_SHOWN_MS = 10 * 60 * 1000
export const WORKING_SHOWN_MS = 30 * 60 * 1000

type WakeFields = Pick<
  AgentWakeRow,
  'status' | 'reason' | 'triggerKind' | 'actorUserId' | 'createdAt' | 'settledAt' | 'endedAt'
>

export function agentWorkOf(
  wake: WakeFields,
  forName: string | null,
  now: number = Date.now()
): AgentWorkView | null {
  const base = { trigger: wake.triggerKind, forUserId: wake.actorUserId, forName, reasonKind: null }
  switch (wake.status) {
    case 'queued':
      return { ...base, state: 'queued', since: wake.createdAt.toISOString() }
    case 'started': {
      const since = wake.settledAt ?? wake.createdAt
      if (now - since.getTime() > WORKING_SHOWN_MS) return null
      return { ...base, state: 'working', since: since.toISOString() }
    }
    case 'failed':
    case 'refused': {
      const endedAt = wake.endedAt ?? wake.settledAt ?? wake.createdAt
      if (now - endedAt.getTime() > FAILED_SHOWN_MS) return null
      return {
        ...base,
        state: 'failed',
        reasonKind: wakeEndReasonKind(wake.status, wake.reason) ?? 'error',
        since: endedAt.toISOString(),
      }
    }
    case 'suppressed':
      if (now - wake.createdAt.getTime() > HELD_SHOWN_MS) return null
      return { ...base, state: 'held', since: wake.createdAt.toISOString() }
    default:
      return null
  }
}

export async function latestWakesFor(
  organizationId: string,
  documentId: string,
  annotationId?: string
): Promise<ReadonlyMap<string, AgentWakeRow>> {
  const rows = await listLatestWakes(organizationId, documentId, annotationId).catch((error: unknown) => {
    console.error('[annotations] the wakes of a document could not be read:', error)
    return []
  })
  return new Map(rows.map((row) => [row.annotationId, row]))
}

export async function announceAgentWork(
  wake: Pick<AgentWakeRow, 'documentId' | 'annotationId' | 'actorUserId'>
): Promise<void> {
  await publishToDocumentRoom(wake.documentId, {
    kind: 'annotations.changed',
    annotationIds: [wake.annotationId],
    change: 'updated',
    actor: { peerId: null, userId: wake.actorUserId, name: PRODUCT_NAME, kind: 'piloti' },
  }).catch(() => undefined)
}

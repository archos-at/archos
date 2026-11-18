import 'server-only'
import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import { listTouchedOfType } from '@/lib/inbox/repository'
import { BURST_HOLD_MS } from './enqueue'

export const FOLD_LOOKBACK_MS = 10 * 60_000

export const FOLD_MAX_ROWS = 50

export type BurstRow = Pick<InboxItem, 'id' | 'updatedAt'>

export function burstOf<T extends BurstRow>(
  row: BurstRow,
  candidates: readonly T[],
  holdMs: number = BURST_HOLD_MS
): 'later' | T[] {
  const at = row.updatedAt.getTime()
  const others = candidates.filter((candidate) => candidate.id !== row.id)
  if (others.some((candidate) => candidate.updatedAt.getTime() > at && candidate.updatedAt.getTime() - at <= holdMs)) {
    return 'later'
  }
  const earlier = others
    .filter((candidate) => candidate.updatedAt.getTime() <= at)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const burst: T[] = []
  let next = at
  for (const candidate of earlier) {
    if (next - candidate.updatedAt.getTime() > holdMs) break
    burst.push(candidate)
    next = candidate.updatedAt.getTime()
  }
  return burst.slice(0, FOLD_MAX_ROWS - 1)
}

export async function readBurst(
  row: InboxItem,
  pushes: (candidate: InboxItem) => boolean = () => true
): Promise<'later' | InboxItem[]> {
  const candidates = await listTouchedOfType(
    row.organizationId,
    row.recipientUserId,
    row.type as InboxItemType,
    { from: new Date(row.updatedAt.getTime() - FOLD_LOOKBACK_MS), to: new Date(row.updatedAt.getTime() + BURST_HOLD_MS) },
    FOLD_MAX_ROWS + 1
  )
  return burstOf(row, candidates.filter(pushes))
}

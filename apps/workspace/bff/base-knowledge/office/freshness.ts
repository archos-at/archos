/**
 * How fresh an entry's last check is (ADR-0163, design §8.1). Pure.
 *
 * A standard, guideline, commentary or law is checked once a year; a directive,
 * which an authority rewrites without notice, twice. An entry never checked, or
 * whose last check found a newer edition, a withdrawal or no answer, is overdue
 * at once: an answer resting on it says so.
 */

import type { KnowledgeWorkKind } from '@/lib/db/schema/knowledge-records'
import type { EntryCheck, Freshness } from '../wire'

const DAY_MS = 24 * 60 * 60 * 1000

export const REVIEW_INTERVAL_DAYS: Readonly<Record<KnowledgeWorkKind, number>> = {
  technical_standard: 365,
  guideline: 365,
  commentary: 365,
  statute: 365,
  authority_directive: 180,
}

export function freshnessOf(kind: KnowledgeWorkKind, lastCheck: EntryCheck | null, now: Date): Freshness {
  const intervalDays = REVIEW_INTERVAL_DAYS[kind]
  if (!lastCheck) return { intervalDays, lastCheck: null, dueAt: null, overdue: true }
  const due = new Date(new Date(lastCheck.checkedAt).getTime() + intervalDays * DAY_MS)
  const overdue = lastCheck.result !== 'current' || due.getTime() <= now.getTime()
  return { intervalDays, lastCheck, dueAt: due.toISOString(), overdue }
}

/**
 * How often the platform checks that a released edition is still current
 * (ADR-0165, design §9 "Now"): statutes every 14 days, adoptions (guidelines a
 * law makes binding, authority directives) every 30, standards, commentaries
 * and registers every 90. An office's own copies keep their own, longer
 * intervals (`office/freshness.ts`): an office checks its purchase, the
 * platform checks the law. Pure.
 */

import type { KnowledgeWorkKind } from '@/lib/base-knowledge/wire/vocab'

export const PLATFORM_FRESHNESS_DAYS: Readonly<Record<KnowledgeWorkKind, number>> = {
  statute: 14,
  ordinance: 14,
  administrative_regulation: 30,
  directive: 90,
  intergovernmental_agreement: 90,
  model_code: 30,
  guideline: 30,
  authority_directive: 30,
  technical_standard: 90,
  commentary: 90,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Overdue: never checked, last found anything but current, or checked longer ago than its kind's target. */
export function platformEditionOverdue(
  kind: KnowledgeWorkKind,
  lastCheck: { checkedAt: Date; result: string } | null,
  now: Date,
): boolean {
  if (!lastCheck || lastCheck.result !== 'current') return true
  return now.getTime() - lastCheck.checkedAt.getTime() >= PLATFORM_FRESHNESS_DAYS[kind] * DAY_MS
}

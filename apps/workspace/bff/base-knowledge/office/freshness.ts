import type { OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import type { DirectoryEdition } from '../platform'
import { newestInForce } from '../time/editions'
import type { DirectoryStanding, EntryCheck, Freshness } from '../wire'

const DAY_MS = 24 * 60 * 60 * 1000

export const REVIEW_INTERVAL_DAYS: Readonly<Record<OfficeWorkKind, number>> = {
  technical_standard: 365,
  guideline: 365,
  commentary: 365,
  statute: 365,
  authority_directive: 180,
}

export function freshnessOf(kind: OfficeWorkKind, lastCheck: EntryCheck | null, now: Date): Freshness {
  const intervalDays = REVIEW_INTERVAL_DAYS[kind]
  if (!lastCheck) return { intervalDays, lastCheck: null, dueAt: null, overdue: true }
  const due = new Date(new Date(lastCheck.checkedAt).getTime() + intervalDays * DAY_MS)
  const overdue = lastCheck.result !== 'current' || due.getTime() <= now.getTime()
  return { intervalDays, lastCheck, dueAt: due.toISOString(), overdue }
}

export interface HeldEdition {
  editionLabel: string
  startsOn: string | null
}

const sameLabel = (a: string, b: string) => {
  const fold = (text: string) => text.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()
  return fold(a) === fold(b)
}

export function directoryStanding(held: readonly HeldEdition[], listed: readonly DirectoryEdition[], day: string): DirectoryStanding | null {
  const found = newestInForce(
    listed.map((edition, index) => ({
      id: String(index),
      label: edition.editionLabel,
      inForceFrom: edition.startsOn,
      inForceTo: edition.endsOn,
      transition: null,
    })),
    day,
  )
  if (found.status !== 'determined' || found.edition.inForceFrom === null) return null
  const inForce = { editionLabel: found.edition.label, startsOn: found.edition.inForceFrom }
  const holds = held.some(
    (edition) => (edition.startsOn !== null && edition.startsOn >= inForce.startsOn) || sameLabel(edition.editionLabel, inForce.editionLabel),
  )
  if (holds) return { inForce, held: true }
  return held.some((edition) => edition.startsOn !== null) ? { inForce, held: false } : null
}

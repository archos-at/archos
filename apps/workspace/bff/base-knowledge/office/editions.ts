/**
 * The editions of one standard the office holds, and which one is in force on a
 * day (ticket 32: „Welche Ausgabe für ein Projekt gilt, richtet sich nach dem
 * Stichtag des Projekts; eine neue Ausgabe kommt hinzu, die bisherige bleibt
 * nutzbar“). Pure.
 *
 * An office holds one work per copy (ADR-0163), so two editions of a standard
 * are two entries. What makes them one series is what a person would read off
 * them: the same kind and the same designation without its edition part
 * (`ÖNORM B 1600:2017` and `ÖNORM B 1600:2023`), or the same title where there
 * is no designation (a commentary's 6th and 7th edition). The platform listing
 * will give them one work to attach to; until then this is the join.
 *
 * An edition is in force from its stated start (`inForceFrom`, else the day it
 * was issued) until the next edition of its series starts, or until its own
 * stated end. Only confirmed entries take part: a proposal is in force nowhere.
 */

import type { EntryValues } from '../wire'

export interface SeriesMember {
  id: string
  confirmed: boolean
  values: Pick<EntryValues, 'kind' | 'designation' | 'title' | 'inForceFrom' | 'inForceTo' | 'issuedOn'>
  createdAt: Date
}

const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()

/** The designation without its edition: everything before `:` (the year or date of the edition). */
export function designationStem(designation: string): string {
  return designation.split(':')[0]
}

export function seriesKeyOf(values: SeriesMember['values']): string {
  const name = values.designation ? designationStem(values.designation) : values.title
  return `${values.kind}|${fold(name)}`
}

/** When an edition starts: its stated start, else its issue day; null when neither is known. */
export const startOf = (member: SeriesMember): string | null => member.values.inForceFrom ?? member.values.issuedOn

/** Later start first; an undated edition counts as the oldest, and among equals the newest entry. */
function newestFirst(a: SeriesMember, b: SeriesMember): number {
  const [left, right] = [startOf(a) ?? '', startOf(b) ?? '']
  if (left !== right) return left < right ? 1 : -1
  return b.createdAt.getTime() - a.createdAt.getTime()
}

/** The confirmed editions of each series, newest first. */
export function seriesOf<T extends SeriesMember>(members: readonly T[]): Map<string, T[]> {
  const series = new Map<string, T[]>()
  for (const member of members) {
    if (!member.confirmed) continue
    const key = seriesKeyOf(member.values)
    series.set(key, [...(series.get(key) ?? []), member])
  }
  for (const editions of series.values()) editions.sort(newestFirst)
  return series
}

/**
 * The edition of a series in force on `day` (YYYY-MM-DD): the newest that had
 * started by then and was not ended. When none had started (every edition is
 * later, or none is dated), the oldest dated one, or the newest undated: the
 * answer then says which edition it used, and a person sees the gap.
 */
export function inForceOn<T extends SeriesMember>(editions: readonly T[], day: string): T | null {
  const started = editions.find((edition) => {
    const start = startOf(edition)
    return start !== null && start <= day && (edition.values.inForceTo === null || edition.values.inForceTo > day)
  })
  if (started) return started
  if (editions.some((edition) => startOf(edition) !== null && startOf(edition)! <= day)) return null // ended, nothing after it
  return editions.at(-1) ?? null
}

/** For each confirmed member: whether it is the series' edition in force on `day`, and the edition that followed it. */
export function editionStanding<T extends SeriesMember>(
  members: readonly T[],
  day: string,
): Map<string, { seriesKey: string; editions: number; inForce: boolean; supersededBy: string | null }> {
  const standing = new Map<string, { seriesKey: string; editions: number; inForce: boolean; supersededBy: string | null }>()
  for (const [seriesKey, editions] of seriesOf(members)) {
    const current = inForceOn(editions, day)
    editions.forEach((edition, index) => {
      standing.set(edition.id, {
        seriesKey,
        editions: editions.length,
        inForce: edition === current,
        supersededBy: index > 0 ? editions[index - 1].id : null,
      })
    })
  }
  return standing
}

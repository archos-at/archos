import { dateToMonth, type Month } from './month'
import type { ProjectPersonKind, ProjectPersonView } from './project-record-types'

export interface StoredPerson {
  id: string
  userId: string | null
  name: string
  function: string | null
  company: string | null
  startedOn: string | null
  endedOn: string | null
}

export interface CurrentMember {
  userId: string
  name: string
  since: Month | null
}

function fromRow(row: StoredPerson, kind: ProjectPersonKind): ProjectPersonView {
  return {
    id: row.id,
    kind,
    userId: row.userId,
    name: row.name,
    function: row.function,
    company: row.company,
    startedOn: dateToMonth(row.startedOn),
    endedOn: dateToMonth(row.endedOn),
  }
}

const byPeriodThenName = (a: ProjectPersonView, b: ProjectPersonView): number =>
  (a.startedOn ?? '').localeCompare(b.startedOn ?? '') || a.name.localeCompare(b.name)

export function mergePeople(rows: readonly StoredPerson[], team: readonly CurrentMember[] | null): ProjectPersonView[] {
  const rowOf = new Map<string, StoredPerson>()
  for (const row of rows) if (row.userId && !rowOf.has(row.userId)) rowOf.set(row.userId, row)

  const members = (team ?? []).map((member): ProjectPersonView => {
    const row = rowOf.get(member.userId)
    return {
      ...(row ? fromRow(row, 'member') : { id: null, function: null, company: null, startedOn: null, endedOn: null }),
      kind: 'member',
      userId: member.userId,
      name: member.name,
      startedOn: dateToMonth(row?.startedOn) ?? member.since,
    }
  })
  const onTeam = new Set((team ?? []).map((member) => member.userId))
  const claimed = new Set(members.map((member) => member.id).filter(Boolean))
  const others = rows
    .filter((row) => !claimed.has(row.id))
    .map((row) => {
      if (!row.userId) return fromRow(row, 'added')
      return fromRow(row, team && !onTeam.has(row.userId) ? 'former' : 'member')
    })
    .sort(byPeriodThenName)
  return [...members, ...others]
}

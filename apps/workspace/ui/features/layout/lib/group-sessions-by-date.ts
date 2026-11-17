import type { Session } from '../types'

export const groupSessionsByDate = (
  sessions: Session[],
  labels: { today: string; yesterday: string },
  locale: string
): Array<[string, Session[]]> => {
  const groups = new Map<string, { sessions: Session[]; sortKey: number }>()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  for (const session of sessions) {
    const sessionDate = new Date(session.date)
    let label: string

    if (isSameDay(sessionDate, today)) {
      label = labels.today
    } else if (isSameDay(sessionDate, yesterday)) {
      label = labels.yesterday
    } else {
      label = sessionDate.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }

    const time = sessionDate.getTime()
    const existing = groups.get(label)
    if (existing) {
      existing.sessions.push(session)
      existing.sortKey = Math.max(existing.sortKey, time)
    } else {
      groups.set(label, { sessions: [session], sortKey: time })
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].sortKey - a[1].sortKey)
    .map(([label, group]) => [label, group.sessions] as [string, Session[]])
}

const isSameDay = (d1: Date, d2: Date): boolean => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

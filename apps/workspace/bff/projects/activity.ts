import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { utcDayStart, utcMonthStart } from '@/lib/budgets/service'
import { countAskingPeople, countQuestionsPerDay, type DailyQuestions } from './activity-repository'

const TREND_DAYS = 30

export interface ProjectActivity {
  questionsThisMonth: number
  peopleThisMonth: number
  daily: DailyQuestions[]
}

export async function getProjectActivity(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectActivity> {
  await requireProjectAccess(session, projectId, 'project:view')

  const trendStart = utcDayStart()
  trendStart.setUTCDate(trendStart.getUTCDate() - (TREND_DAYS - 1))
  const monthStart = utcMonthStart()
  const from = monthStart < trendStart ? monthStart : trendStart

  const [rows, peopleThisMonth] = await Promise.all([
    countQuestionsPerDay(session.organizationId, projectId, from),
    countAskingPeople(session.organizationId, projectId, monthStart),
  ])

  const byDay = new Map(rows.map((row) => [row.day, row.questions]))
  const monthKey = monthStart.toISOString().slice(0, 10)
  const questionsThisMonth = rows
    .filter((row) => row.day >= monthKey)
    .reduce((sum, row) => sum + row.questions, 0)

  const daily: DailyQuestions[] = []
  const cursor = new Date(trendStart)
  for (let i = 0; i < TREND_DAYS; i += 1) {
    const day = cursor.toISOString().slice(0, 10)
    daily.push({ day, questions: byDay.get(day) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return { questionsThisMonth, peopleThisMonth, daily }
}

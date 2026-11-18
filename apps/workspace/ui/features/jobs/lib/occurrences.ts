export interface Occurrence {
  jobId: string
  at: Date
}

type CronModule = typeof import('cron-parser')

let parserPromise: Promise<CronModule> | null = null

function loadCronParser(): Promise<CronModule> {
  parserPromise ??= import('cron-parser')
  return parserPromise
}

const PER_SCHEDULE_CAP = 96

export interface ScheduleSpec {
  id: string
  cron: string | null
  timezone: string
  dueAt?: Date | null
  enabled: boolean
}

export interface ExpansionResult {
  occurrences: Occurrence[]
  truncated: string[]
  invalid: string[]
}

export async function expandWindow(
  schedules: readonly ScheduleSpec[],
  from: Date,
  to: Date,
): Promise<ExpansionResult> {
  const { CronExpressionParser } = await loadCronParser()
  const occurrences: Occurrence[] = []
  const truncated: string[] = []
  const invalid: string[] = []

  for (const schedule of schedules) {
    if (!schedule.enabled) continue

    if (!schedule.cron) {
      if (schedule.dueAt && schedule.dueAt >= from && schedule.dueAt < to) {
        occurrences.push({ jobId: schedule.id, at: schedule.dueAt })
      }
      continue
    }
    let interval: ReturnType<typeof CronExpressionParser.parse>
    try {
      interval = CronExpressionParser.parse(schedule.cron, {
        tz: schedule.timezone,
        currentDate: new Date(from.getTime() - 1),
      })
    } catch {
      invalid.push(schedule.id)
      continue
    }

    for (let taken = 0; taken < PER_SCHEDULE_CAP; taken += 1) {
      const next = nextOrNull(interval)
      if (!next || next.getTime() >= to.getTime()) break
      occurrences.push({ jobId: schedule.id, at: next })
      if (taken === PER_SCHEDULE_CAP - 1) truncated.push(schedule.id)
    }
  }

  occurrences.sort((a, b) => a.at.getTime() - b.at.getTime())
  return { occurrences, truncated, invalid }
}

export async function nextOccurrences(
  cron: string,
  timezone: string,
  count: number,
  after: Date = new Date(),
): Promise<Date[]> {
  const { CronExpressionParser } = await loadCronParser()
  let interval: ReturnType<typeof CronExpressionParser.parse>
  try {
    interval = CronExpressionParser.parse(cron, { tz: timezone, currentDate: after })
  } catch {
    return []
  }
  const out: Date[] = []
  for (let taken = 0; taken < count; taken += 1) {
    const next = nextOrNull(interval)
    if (!next) break
    out.push(next)
  }
  return out
}

function nextOrNull(interval: { next: () => { toDate: () => Date } }): Date | null {
  try {
    return interval.next().toDate()
  } catch {
    return null
  }
}

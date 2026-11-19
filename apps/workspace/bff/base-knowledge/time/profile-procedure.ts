import { z } from 'zod'
import { procedureSchema, type Procedure } from '@/lib/base-knowledge/wire/time'

type ProfileFacts = Readonly<Record<string, { value?: unknown } | undefined>>

const calendarDay = z.iso.date()
const isDay = (value: unknown): value is string => calendarDay.safeParse(value).success

function read(facts: ProfileFacts, key: string, procedureId: string): unknown {
  return facts[`${key}@${procedureId}`]?.value ?? null
}

function dateOr<T extends string>(value: unknown, word: T): string | T | null {
  if (value === word) return word
  return isDay(value) ? value : null
}

export function procedureFromProfile(facts: ProfileFacts, procedureId: string): Procedure {
  const type = read(facts, 'procedure_type', procedureId)
  const filedOn = read(facts, 'filed_on', procedureId)
  return procedureSchema.parse({
    procedureType: typeof type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(type) ? type : null,
    filedOn: isDay(filedOn) ? filedOn : null,
    decidedOn: dateOr(read(facts, 'decided_on', procedureId), 'pending'),
    worksStartedOn: dateOr(read(facts, 'works_started_on', procedureId), 'not_started'),
  })
}

export function profileHasProcedure(facts: ProfileFacts, procedureId: string): boolean {
  return Object.keys(facts).some((key) => key.endsWith(`@${procedureId}`))
}

export const PROFILE_PROCEDURE_IDS = ['p1'] as const

export function referenceDayOfProfile(facts: ProfileFacts, today: string): string | null {
  for (const id of PROFILE_PROCEDURE_IDS) {
    if (!profileHasProcedure(facts, id)) continue
    const { filedOn } = procedureFromProfile(facts, id)
    if (filedOn && filedOn <= today) return filedOn
  }
  return null
}

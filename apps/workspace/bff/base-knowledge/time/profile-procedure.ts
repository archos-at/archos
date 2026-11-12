/**
 * A procedure as a project's profile holds it (design §3.6): facts scoped to
 * the procedure, `procedure_type@p1`, `filed_on@p1`, `decided_on@p1`,
 * `works_started_on@p1`, written through `project-profile-patch` like every
 * other fact (ADR-0111's confirmation). Pure.
 *
 * A value that is not what the fact holds is read as unknown, never coerced:
 * an unknown date is asked for, and a wrong one would decide.
 */

import { z } from 'zod'
import { procedureSchema, type Procedure } from '@/lib/base-knowledge/wire/time'

type ProfileFacts = Readonly<Record<string, { value?: unknown } | undefined>>

/** A calendar day (`2024-02-29` yes, `2023-02-30` no), checked per fact so one wrong date leaves the others. */
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
  // Each fact is checked on its own, so the schema cannot fail and no valid fact is lost to another's error.
  return procedureSchema.parse({
    procedureType: typeof type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(type) ? type : null,
    filedOn: isDay(filedOn) ? filedOn : null,
    decidedOn: dateOr(read(facts, 'decided_on', procedureId), 'pending'),
    worksStartedOn: dateOr(read(facts, 'works_started_on', procedureId), 'not_started'),
  })
}

/** Whether the profile names this procedure at all. */
export function profileHasProcedure(facts: ProfileFacts, procedureId: string): boolean {
  return Object.keys(facts).some((key) => key.endsWith(`@${procedureId}`))
}

/** The procedures a project's profile names, by id (`filed_on@p1`, …). One today. */
export const PROFILE_PROCEDURE_IDS = ['p1'] as const

/**
 * The day a project's knowledge resolves on: its procedure's filing day once
 * that has come, else `today` (the knowledge context's rule, `referenceDateOf`
 * in `context/service.ts`, which also says which of the two it took).
 */
export function referenceDayOfProfile(facts: ProfileFacts, today: string): string {
  for (const id of PROFILE_PROCEDURE_IDS) {
    if (!profileHasProcedure(facts, id)) continue
    const { filedOn } = procedureFromProfile(facts, id)
    if (filedOn && filedOn <= today) return filedOn
  }
  return today
}

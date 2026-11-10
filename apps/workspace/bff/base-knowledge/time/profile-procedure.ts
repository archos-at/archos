/**
 * A procedure as a project's profile holds it (design §3.6): facts scoped to
 * the procedure, `procedure_type@p1`, `filed_on@p1`, `decided_on@p1`,
 * `works_started_on@p1`, written through `project-profile-patch` like every
 * other fact (ADR-0111's confirmation). Pure.
 *
 * A value that is not what the fact holds is read as unknown, never coerced:
 * an unknown date is asked for, and a wrong one would decide.
 */

import { procedureSchema, type Procedure } from '@/lib/base-knowledge/wire/time'

type ProfileFacts = Readonly<Record<string, { value?: unknown } | undefined>>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function read(facts: ProfileFacts, key: string, procedureId: string): unknown {
  return facts[`${key}@${procedureId}`]?.value ?? null
}

function dateOr<T extends string>(value: unknown, word: T): string | T | null {
  if (value === word) return word
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null
}

export function procedureFromProfile(facts: ProfileFacts, procedureId: string): Procedure {
  const type = read(facts, 'procedure_type', procedureId)
  const filedOn = read(facts, 'filed_on', procedureId)
  const parsed = procedureSchema.safeParse({
    procedureType: typeof type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(type) ? type : null,
    filedOn: typeof filedOn === 'string' && ISO_DATE.test(filedOn) ? filedOn : null,
    decidedOn: dateOr(read(facts, 'decided_on', procedureId), 'pending'),
    worksStartedOn: dateOr(read(facts, 'works_started_on', procedureId), 'not_started'),
  })
  // A calendar-invalid date (2023-02-30) fails the schema; the whole procedure is then unknown.
  return parsed.success ? parsed.data : procedureSchema.parse({})
}

/** Whether the profile names this procedure at all. */
export function profileHasProcedure(facts: ProfileFacts, procedureId: string): boolean {
  return Object.keys(facts).some((key) => key.endsWith(`@${procedureId}`))
}

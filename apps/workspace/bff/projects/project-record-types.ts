import { z } from 'zod'
import { isMonth, isOrderedPeriod, type Month } from './month'

const monthField = z
  .string()
  .refine(isMonth, { message: 'Expected a month as YYYY-MM' })
  .transform((value) => value as Month)
  .nullable()

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()

export const projectPeriodSchema = z.object({ startedOn: monthField }).strict()
export type ProjectPeriodInput = z.infer<typeof projectPeriodSchema>

export const projectPersonSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    function: optionalText(200),
    company: optionalText(200),
    startedOn: monthField,
    endedOn: monthField,
    userId: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .refine((person) => isOrderedPeriod(person.startedOn, person.endedOn), {
    message: 'The end lies before the start',
    path: ['endedOn'],
  })
export type ProjectPersonInput = z.infer<typeof projectPersonSchema>

export type ProjectPersonKind = 'member' | 'former' | 'added'

export interface ProjectPersonView {
  id: string | null
  kind: ProjectPersonKind
  userId: string | null
  name: string
  function: string | null
  company: string | null
  startedOn: Month | null
  endedOn: Month | null
}

export interface ProjectRecordView {
  address: string | null
  startedOn: Month | null
  startedOnIsDefault: boolean
  endedOn: Month | null
  people: ProjectPersonView[]
  rosterKnown: boolean
  canEdit: boolean
  canErase: boolean
}

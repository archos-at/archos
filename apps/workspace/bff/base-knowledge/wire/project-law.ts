import { z } from 'zod'
import { APPLICABILITY_VERDICTS, EDITION_ROLES, GATE_STATES, type GateState } from './vocab'

export const useApplicabilitySchema = z
  .object({
    verdict: z.enum(APPLICABILITY_VERDICTS),
    basis: z.array(z.string()).max(32),
    open: z.array(z.string()).max(32),
    provision: z.string().nullable(),
  })
  .strict()
export type UseApplicability = z.infer<typeof useApplicabilitySchema>

const REFUSING: ReadonlySet<GateState> = new Set(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'])

export const gateNamesLaw = (gate: GateState): boolean => !REFUSING.has(gate)

export const projectLawUseSchema = z
  .object({
    workId: z.string(),
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    qualifier: z.enum(['uncurated', 'office_maintained']).nullable(),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
    applicability: useApplicabilitySchema.nullable(),
    sourceUrl: z.url().max(2000).nullable(),
  })
  .strict()

export const MAX_PROJECT_LAW_USES = 40

export const projectLawSchema = z
  .object({
    gate: z.enum(GATE_STATES),
    uses: z.array(projectLawUseSchema).max(MAX_PROJECT_LAW_USES),
    factLabels: z.record(z.string(), z.string()),
  })
  .strict()

export type ProjectLaw = z.infer<typeof projectLawSchema>
export type ProjectLawUse = z.infer<typeof projectLawUseSchema>

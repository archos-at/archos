/**
 * The law at a project's site as a person reads it (ADR-0175): the gate of the
 * project's knowledge context and each of its uses with the role and qualifier
 * the turn reads, named by its work's designation and its edition's label. What
 * the Steckbrief and `project-base-get` show; it replaced the OIB verdict list.
 * Pure and zod, shared by the intake view and the operation's wire.
 */

import { z } from 'zod'
import { APPLICABILITY_VERDICTS, EDITION_ROLES, GATE_STATES } from './vocab'

/**
 * Whether a use's edition applies to the project's buildings (ADR-0177), as
 * the knowledge context and the project's law carry it. Null on a use whose
 * edition states no scope: the chain did not narrow it.
 */
export const useApplicabilitySchema = z
  .object({
    /** `applies` or `check`: an edition no building needs is not on the wire at all. */
    verdict: z.enum(APPLICABILITY_VERDICTS),
    /** The building facts the deciding rows read: why it applies. */
    basis: z.array(z.string()).max(32),
    /** For `check`: the building facts whose answer would decide it; empty when the case needs a person. */
    open: z.array(z.string()).max(32),
    /** The provision the deciding row cites: the edition's scope clause. */
    provision: z.string().nullable(),
  })
  .strict()
export type UseApplicability = z.infer<typeof useApplicabilitySchema>

/** One use: the work and edition, the role and qualifier the turn reads, and the names a person reads. */
export const projectLawUseSchema = z
  .object({
    workId: z.string(),
    /** Null for law read live at its source: the consolidated text in force today. */
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    /** `uncurated`: binding law from an official source nobody reviewed; `office_maintained`: the office keeps this copy. */
    qualifier: z.enum(['uncurated', 'office_maintained']).nullable(),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
    /** Whether the edition applies to the project's buildings, and why (ADR-0177); null where its edition states no scope. */
    applicability: useApplicabilitySchema.nullable(),
    /** Where a person opens the edition's text: the page its manifestation cites; null when none does. */
    sourceUrl: z.url().max(2000).nullable(),
  })
  .strict()

/** The gate, and the uses where it names law: none where it refuses. At most MAX_CONTEXT_USES (40), as the context. */
export const projectLawSchema = z
  .object({
    gate: z.enum(GATE_STATES),
    uses: z.array(projectLawUseSchema).max(40),
    /** The label of each building fact a use's applicability names, in the country's terms. */
    factLabels: z.record(z.string(), z.string()),
  })
  .strict()

export type ProjectLaw = z.infer<typeof projectLawSchema>
export type ProjectLawUse = z.infer<typeof projectLawUseSchema>

/**
 * The law at a project's site as a person reads it (ADR-0175): the gate of the
 * project's knowledge context and each of its uses with the role and qualifier
 * the turn reads, named by its work's designation and its edition's label. What
 * the Steckbrief and `project-base-get` show; it replaced the OIB verdict list.
 * Pure and zod, shared by the intake view and the operation's wire.
 */

import { z } from 'zod'
import { EDITION_ROLES, GATE_STATES } from './vocab'

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
  })
  .strict()

/** The gate, and the uses where it names law: none where it refuses. At most MAX_CONTEXT_USES (40), as the context. */
export const projectLawSchema = z
  .object({
    gate: z.enum(GATE_STATES),
    uses: z.array(projectLawUseSchema).max(40),
  })
  .strict()

export type ProjectLaw = z.infer<typeof projectLawSchema>
export type ProjectLawUse = z.infer<typeof projectLawUseSchema>

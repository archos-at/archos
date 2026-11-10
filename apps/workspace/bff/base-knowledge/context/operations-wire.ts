/**
 * The wire of the knowledge context's operations (ADR-0173, design §4.5):
 * `coverage-get`, `base-knowledge-report`, `project-base-get` and
 * `project-base-confirm`. Shared by the routes and the agent catalog, so the
 * contract is written once (ADR-0055). English, one word per concept.
 */

import { z } from 'zod'
import { COVERAGE_LEVELS, EDITION_ROLES } from '../wire/vocab'
import { GATE_STATES, knowledgeContextSchema, MAX_CONTEXT_USES } from './wire'

const countryId = z.string().regex(/^[A-Z]{2}$/, 'an ISO 3166-1 alpha-2 code such as DE')

export const coverageQuerySchema = z
  .object({
    countryId: countryId.optional().describe('One country, e.g. DE; omitted, every country the office is entitled to.'),
  })
  .strict()

export const coverageNodeSchema = z
  .object({
    territoryId: z.string(),
    name: z.string(),
    kind: z.string(),
    /** The coverage this node states; null inherits from its parent. */
    level: z.enum(COVERAGE_LEVELS).nullable(),
    municipalLaw: z.boolean().nullable(),
  })
  .strict()

export const coverageViewSchema = z
  .object({
    countries: z.array(
      z
        .object({
          countryId,
          /** The country's own coverage; `none` when no node states one. */
          level: z.enum(COVERAGE_LEVELS),
          /** The nodes below it that state a coverage of their own. */
          nodes: z.array(coverageNodeSchema).max(500),
        })
        .strict(),
    ),
  })
  .strict()

export const baseKnowledgeReportBodySchema = z
  .object({
    countryId,
    workId: z.string().trim().min(1).max(200).optional().describe('The work the report is about, e.g. work:baybo.'),
    editionId: z.string().trim().min(1).max(200).optional(),
    messageId: z.uuid().optional().describe('The answer that showed the wrong law, from the conversation.'),
    note: z.string().trim().min(3).max(150).describe('What is wrong, in a sentence: the platform reads it on the draft change request.'),
  })
  .strict()

export const baseKnowledgeReportResultSchema = z.object({ changeRequestId: z.uuid(), status: z.literal('draft') }).strict()

/** One edition the law at a project's site names, as a person reads it: its designation, edition and role there. */
export const projectLawUseSchema = z
  .object({
    workId: z.string(),
    /** Null for law read live at its source: the consolidated text in force today. */
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    designation: z.string().nullable(),
    editionLabel: z.string().nullable(),
  })
  .strict()

/**
 * The law at a project's site from the platform's records (ADR-0175): the
 * gate of its knowledge context, and the editions the chain names with their
 * role. Empty where the gate refuses (no home country, no site, a country the
 * office is not entitled to, records that could not be read, no coverage).
 * What the project's Steckbrief shows; it replaced the OIB verdict list.
 */
export const projectLawSchema = z
  .object({
    gate: z.enum(GATE_STATES),
    uses: z.array(projectLawUseSchema).max(MAX_CONTEXT_USES),
  })
  .strict()

export const projectBaseViewSchema = z
  .object({
    context: knowledgeContextSchema,
    /** The law at the site, with designations and editions: what a person reads of the context. */
    law: projectLawSchema,
    /** The newest base a person confirmed for this project (the Steckbrief); null when none was. */
    confirmed: z
      .object({ id: z.uuid(), confirmedAt: z.string(), confirmedBy: z.string(), packSeqs: z.record(z.string(), z.number()) })
      .strict()
      .nullable(),
  })
  .strict()

export const projectBaseConfirmBodySchema = z
  .object({
    packs: z
      .array(z.object({ packId: z.string(), seq: z.number().int().nonnegative() }).strict())
      .max(16)
      .describe('The packs and sequences of the base the person saw, from project-base-get; a newer release refuses the confirmation (409).'),
  })
  .strict()

export const projectBaseConfirmResultSchema = z.object({ id: z.uuid(), confirmedAt: z.string() }).strict()

export type CoverageQuery = z.infer<typeof coverageQuerySchema>
export type CoverageView = z.infer<typeof coverageViewSchema>
export type BaseKnowledgeReportBody = z.infer<typeof baseKnowledgeReportBodySchema>
export type BaseKnowledgeReportResult = z.infer<typeof baseKnowledgeReportResultSchema>
export type ProjectBaseView = z.infer<typeof projectBaseViewSchema>
export type ProjectLaw = z.infer<typeof projectLawSchema>
export type ProjectLawUse = z.infer<typeof projectLawUseSchema>
export type ProjectBaseConfirmBody = z.infer<typeof projectBaseConfirmBodySchema>
export type ProjectBaseConfirmResult = z.infer<typeof projectBaseConfirmResultSchema>

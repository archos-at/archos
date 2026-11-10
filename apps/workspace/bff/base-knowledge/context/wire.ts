/**
 * The knowledge context of one turn (design §5.5, ADR-0173): which country,
 * which territories, which coverage and which editions apply, and what the
 * turn may retrieve. Tokens and ids only, never norm text and never prose the
 * model would read as an instruction; the agent and the answer's renderer word
 * them. Pure and zod, shared by the turn-context route, its specs and the
 * Python tier (`turn/knowledge_context.py` parses the same shape).
 */

import { z } from 'zod'
import { CONNECTING_FACTORS, COVERAGE_LEVELS, EDITION_ROLES } from '../wire/vocab'

/** Most uses a turn carries (design §5.5: works ≤ 40). */
export const MAX_CONTEXT_USES = 40

/**
 * What the turn may claim about the law of its site, weakest first after the
 * three refusals:
 *
 * - `organization_unplaced`: the office has no home country; nothing territorial answers (E47).
 * - `site_unknown`: no site and no place the turn named; the answer asks for the place (E04).
 * - `not_entitled`: the site's country is not entitled; documents and office copies still answer (E01).
 * - `knowledge_unavailable`: the records could not be read; retrieval, law lookup and classification are withheld.
 * - a coverage level: how far the platform's records go at the weakest leaf (design §4.6).
 */
export const GATE_STATES = ['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', ...COVERAGE_LEVELS] as const
export type GateState = (typeof GATE_STATES)[number]

/** Why a site is unknown: no site was stated, or a point lies in no territory the records hold. */
export const SITE_UNKNOWN_REASONS = ['no_site', 'no_territory'] as const

/** How sure the site is: confirmed from a register or by a person, or only assumed. */
export const SITE_CERTAINTY = ['verified', 'unverified'] as const

/**
 * The label tokens an edition use carries (design §4.6, §5.2). The renderer
 * words each: `uncurated_source` "amtliche Quelle, nicht kuratiert, Fassung vom
 * <date>", `check_overdue` "Prüfung überfällig", `unchecked_since` "Stand seit
 * <date> nicht geprüft", `depends_on_connecting_factor` "hängt vom Bürositz /
 * Auftraggeber ab".
 */
export const USE_LABELS = ['uncurated_source', 'check_overdue', 'unchecked_since', 'depends_on_connecting_factor'] as const

export const FRESHNESS = ['current', 'check_due', 'newer_known', 'superseded'] as const

export const leafSchema = z
  .object({
    territoryId: z.string(),
    country: z.string().regex(/^[A-Z]{2}$/),
    certainty: z.enum(SITE_CERTAINTY),
    entitled: z.boolean(),
    /** The coverage that holds here, inherited from the nearest node of the same country that states one; null when none does. */
    coverage: z.enum(COVERAGE_LEVELS).nullable(),
    /** Whether the municipality's own law is held, stated with the coverage that holds; null when no node states it. */
    municipalLaw: z.boolean().nullable(),
  })
  .strict()

export const gateSchema = z
  .object({
    state: z.enum(GATE_STATES),
    reason: z.enum(SITE_UNKNOWN_REASONS).nullable(),
    leaves: z.array(leafSchema).max(8),
  })
  .strict()

export const contextUseSchema = z
  .object({
    workId: z.string(),
    /** Null for law read live at its source: the consolidated text in force today. */
    editionId: z.string().nullable(),
    role: z.enum(EDITION_ROLES),
    qualifier: z.enum(['uncurated', 'office_maintained']).nullable(),
    via: z.enum(['territory', 'relation', 'none']),
    /** The date the role holds on: the resolution day. */
    date: z.iso.date(),
    freshness: z.enum(FRESHNESS),
    /** The platform's newest check, as a day; null when never checked or law read live. */
    lastCheckedAt: z.iso.date().nullable(),
    connectsBy: z.array(z.enum(CONNECTING_FACTORS)).min(1),
    labels: z.array(z.enum(USE_LABELS)).max(USE_LABELS.length),
    corpusFiles: z.array(z.string()),
  })
  .strict()

export const procedureContextSchema = z
  .object({
    id: z.string(),
    procedureType: z.string().nullable(),
    filedOn: z.string().nullable(),
    decidedOn: z.string().nullable(),
    /** The reference day per legislating node; `undetermined` until a reviewed rule names it (design §5.4, "nicht bestimmt" until `full`). */
    stichtage: z.record(
      z.string(),
      z.object({ date: z.iso.date().nullable(), basis: z.enum(['undetermined', 'filed_on']) }).strict(),
    ),
  })
  .strict()

export const knowledgeContextSchema = z
  .object({
    gate: gateSchema,
    /** The territorial packs the turn read and their stable release sequence: what a running research turn pins (E42). */
    packs: z.array(z.object({ packId: z.string(), seq: z.number().int().nonnegative() }).strict()).max(16),
    /** Each leaf's chain at the date, leaf first. */
    chains: z.record(z.string(), z.array(z.string()).max(16)),
    date: z.iso.date(),
    procedures: z.array(procedureContextSchema).max(4),
    uses: z.array(contextUseSchema).max(MAX_CONTEXT_USES),
    /** What the turn may retrieve from the shared corpus: the countries whose chunks it may read. Empty reads none. */
    retrieval: z.object({ countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(300) }).strict(),
    /**
     * The packs released since the conversation's last answer that recorded a use
     * (E42): the answer says "Grundlage seit der letzten Antwort aktualisiert".
     * Read per conversation, after the cached context; absent outside one.
     */
    updatedSinceLastAnswer: z.array(z.string()).max(16).optional(),
  })
  .strict()

export type Leaf = z.infer<typeof leafSchema>
export type Gate = z.infer<typeof gateSchema>
export type ContextUse = z.infer<typeof contextUseSchema>
export type ProcedureContext = z.infer<typeof procedureContextSchema>
export type KnowledgeContext = z.infer<typeof knowledgeContextSchema>
export type UseLabel = (typeof USE_LABELS)[number]

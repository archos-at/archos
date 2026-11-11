/**
 * A golden case (migration 0228, ADR-0165 amendment, design §4.4): one question
 * of a country's quality bar, with what a right answer says and what it must
 * not do. A platform record like any other: proposed, reviewed claim by claim
 * and published per country. Country-neutral: a field names what it is for,
 * and every word of a country's law or language is a value in the record.
 *
 * Also the wire of a golden run: what one scored case and one run read as.
 * Pure zod and types, shared by the routes, the agent operations and the scorer.
 */

import { z } from 'zod'
import { SOURCE_KINDS } from '@/shared/vocabularies.generated'
import { EDITION_ROLES } from './vocab'

/**
 * Where an expected value was taken from: the country's `records` (an edition's
 * dates, a relation's route), the `text` of a held edition, or `unconfirmed`,
 * which a reviewer still has to confirm against the source. An unconfirmed
 * expectation is scored and shown, and never decides whether a case passed.
 */
export const GOLDEN_GROUNDINGS = ['records', 'text', 'unconfirmed'] as const
export type GoldenGrounding = (typeof GOLDEN_GROUNDINGS)[number]

/** The confidence an answer states about itself. */
export const ANSWER_CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const
export type AnswerConfidenceLevel = (typeof ANSWER_CONFIDENCE_LEVELS)[number]

/** Whether a must-not applies whatever the records say, only once the site's records are released, or only before. */
export const GOLDEN_RECORD_STATES = ['any', 'released', 'unreleased'] as const

/** The text a phrase rule reads: the answer, or the reason the answer gives for its confidence. */
export const GOLDEN_PHRASE_TARGETS = ['answer', 'confidence_reason'] as const

const phrase = z.string().trim().min(1).max(160)
const phrases = z.array(phrase).min(1).max(12)
const ruleId = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'lower-case words and dashes, e.g. "web-copy-cited"')
const grounding = z.enum(GOLDEN_GROUNDINGS).describe('records, text, or unconfirmed: a reviewer still confirms it against the source.')

const expectedValue = z.object({
  label: z.string().trim().min(1).max(120).describe('What the value is, e.g. "longest escape route to the stair".'),
  anyOf: phrases.describe('The value as an answer may write it; one of them must appear in the answer.'),
  grounding,
})

const mustNot = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phrase'),
    id: ruleId,
    in: z.enum(GOLDEN_PHRASE_TARGETS).default('answer'),
    anyOf: phrases.describe('Violated when one of these appears.'),
    whenConfidence: z.array(z.enum(ANSWER_CONFIDENCE_LEVELS)).max(3).default([]).describe('Only at these confidence levels; empty: at any.'),
    whenRecords: z.enum(GOLDEN_RECORD_STATES).default('any').describe('unreleased: only while the site’s records are not published.'),
  }),
  z.object({
    kind: z.literal('source'),
    id: ruleId,
    sourceKinds: z.array(z.enum(SOURCE_KINDS)).min(1).max(SOURCE_KINDS.length).describe('Violated when the answer cites a source of one of these kinds.'),
    naming: z.array(phrase).max(12).default([]).describe('Only a source whose name or address holds one of these; empty: any such source.'),
  }),
])

/** A golden case's own fields, on the schemas the platform wire uses for a territory id and a record key. */
export function goldenCaseFields(territoryId: z.ZodType<string>, recordKey: z.ZodType<string>) {
  return {
    question: z.string().trim().min(1).max(1000).describe('The question as a person asks it.'),
    language: z.string().trim().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a BCP 47 tag such as de-AT').describe('The language of the question and of every expected phrase.'),
    context: z
      .object({
        territoryId: territoryId.nullable().default(null).describe('The site the question is asked for; null: asked with no site.'),
        facts: z
          .record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), z.union([z.string().max(200), z.number(), z.boolean()]))
          .default({})
          .describe('The project facts the question needs, by fact key (fact_definitions).'),
        referenceDate: z.iso.date().nullable().default(null).describe('The day the answer is about, e.g. a filing day; null: today.'),
        note: z.string().trim().min(1).max(500).nullable().default(null).describe('What else the scenario needs that a run cannot state, e.g. an office document.'),
      })
      .default({ territoryId: null, facts: {}, referenceDate: null, note: null }),
    expected: z.object({
      values: z.array(expectedValue).max(12).default([]),
      edition: z
        .object({
          editionKey: recordKey.describe('The edition a right answer rests on, proposed here or already published.'),
          anyOf: phrases.describe('How an answer names that edition, e.g. its label.'),
          role: z.enum(EDITION_ROLES).nullable().default(null).describe('What the edition is to the site, when the case states it.'),
          grounding,
        })
        .nullable()
        .default(null),
      citations: z
        .array(
          z.object({
            designation: phrase.describe('The instrument as its citation names it.'),
            alsoKnownAs: z.array(phrase).max(8).default([]).describe('Other names a source may carry for it.'),
            locus: phrase.nullable().default(null).describe('The clause, section or paragraph, as the citation writes it.'),
            grounding,
          }),
        )
        .max(6)
        .default([]),
    }),
    mustNot: z.array(mustNot).max(12).default([]),
    tags: z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9:_-]{0,39}$/)).max(20).default([]),
  }
}

type Fields = ReturnType<typeof goldenCaseFields>
export type GoldenCaseContext = z.infer<Fields['context']>
export type GoldenCaseExpected = z.infer<Fields['expected']>
export type GoldenCaseMustNot = z.infer<typeof mustNot>

/** A golden case as the scorer and a run read it. */
export interface GoldenCase {
  key: string
  question: string
  language: string
  context: GoldenCaseContext
  expected: GoldenCaseExpected
  mustNot: GoldenCaseMustNot[]
  tags: string[]
}

/** One source an answer cites, as the scorer reads it. */
export interface GoldenAnswerSource {
  name: string
  kind?: (typeof SOURCE_KINDS)[number]
  url?: string
  clause?: string
  documentId?: string
}

/** An answer as the scorer reads it: what the reader got, never how the turn found it. */
export interface GoldenAnswer {
  text: string
  confidence: { level: AnswerConfidenceLevel; reason?: string } | null
  sources: GoldenAnswerSource[]
  /** Whether the site's records are published (the gate is a coverage level above `none`). */
  recordsReleased: boolean
}

export const GOLDEN_CHECK_KINDS = ['value', 'edition', 'citation', 'must_not'] as const

export interface GoldenCheck {
  kind: (typeof GOLDEN_CHECK_KINDS)[number]
  /** The value's label, the edition key, the citation's designation, or the must-not's id. */
  id: string
  passed: boolean
  /** False for an unconfirmed expectation: shown, and never decides the case. */
  decides: boolean
  detail: string
}

/**
 * The Langfuse scores one scored case carries, by name (declared in
 * `agent.observability.golden_scores`). A score is absent where the case
 * states nothing it could be measured against.
 */
export type GoldenScores = Partial<Record<(typeof GOLDEN_SCORE_NAMES)[number], number | boolean>>

export const GOLDEN_SCORE_NAMES = [
  'golden-case-passed',
  'golden-expected-values',
  'golden-must-not-violations',
  'golden-seconds',
  'golden-cost-usd',
  'claim-citation-resolves',
] as const

/** One case of a run, scored: what `knowledge_golden_run_cases.result` holds. */
export interface GoldenCaseResult {
  checks: GoldenCheck[]
  scores: GoldenScores
  /** Expectations a reviewer has not confirmed yet. */
  unconfirmed: number
  /** Nothing decided the case (every expectation unconfirmed, no must-not): it is neither passed nor failed. */
  unverified?: boolean
  confidence: AnswerConfidenceLevel | null
  /** Server seconds from the ask to its answer. */
  seconds: number | null
  /** What the turn cost, from the usage ledger; null when the ledger holds no row for it. */
  costUsd: number | null
  traceId: string | null
}

export const goldenRunBodySchema = z.object({
  countryId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .describe('The country whose golden cases run.'),
  changeRequestId: z.uuid().optional().describe('Run the golden cases of this change request (published to preview) instead of the released ones.'),
  caseKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(200).optional().describe('Only these cases; all of them when absent.'),
})

export const goldenRunParamsSchema = z.object({ runId: z.uuid().describe('The run id, from platform-knowledge-golden-run.') })

export const goldenRunAdvanceBodySchema = z.object({
  waitSeconds: z.number().int().min(0).max(40).default(20).describe('How long to wait for running cases before answering.'),
})

export interface GoldenRunCaseView {
  key: string
  recordId: string
  question: string
  state: 'pending' | 'asked' | 'settled'
  passed: boolean | null
  failure: string | null
  askId: string | null
  result: GoldenCaseResult | null
}

export interface GoldenRunView {
  runId: string
  countryId: string
  changeRequestId: string | null
  /** The country's newest stable release the answers were given on. */
  releaseSeq: number | null
  startedAt: string
  finishedAt: string | null
  /** Cases by state, and how many passed; `unconfirmed` counts expectations no reviewer confirmed. */
  summary: { cases: number; pending: number; asked: number; settled: number; passed: number; failed: number; unverified: number; unanswered: number; unconfirmed: number }
  /** Median over the settled cases; null while none has one. */
  medianSeconds: number | null
  medianCostUsd: number | null
  /** The Langfuse dataset run the scores are on; null where Langfuse is not configured. */
  datasetRun: string | null
  cases: GoldenRunCaseView[]
}

import 'server-only'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import {
  knowledgeRecords,
  knowledgeRulesetRevisions,
  type KnowledgeProvenance,
} from '@/lib/db/schema/knowledge-records'
import { rulesetValuesSchema, type RulesetValuesInput } from '../wire/ruleset'
import type { RulesetPayloadSchema, RulesetPurpose } from '../wire/vocab'
import { failingExamples } from '../rulesets/decision-table'
import { rulesetColumns } from '../rulesets/columns'
import type { StoredRuleset } from '../rulesets/select'
import { appendRevision, newRecordId, type RulesetBody } from './repository'
import { recordReadable } from './visibility'

export const MAX_RULESETS = 500

export class RulesetRejectedError extends Error {
  override name = 'RulesetRejectedError'
}

export function writableRuleset(input: RulesetValuesInput) {
  const parsed = rulesetValuesSchema.safeParse(input)
  if (!parsed.success)
    throw new RulesetRejectedError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    )
  const values = parsed.data
  if (values.body.kind === 'table') {
    const failing = failingExamples(values.body.payload)
    if (failing.length > 0)
      throw new RulesetRejectedError(
        `examples ${failing.map((failure) => failure.index).join(', ')} do not hold`
      )
  }
  return values
}

function bodyOf(values: ReturnType<typeof writableRuleset>): RulesetBody {
  return rulesetColumns(values)
}

const KIND_OF_SCHEMA = {
  'decision_table.v1': 'table',
  'fact_definitions.v1': 'fact_definitions',
  'fact_sources.v1': 'fact_sources',
  'advice_policy.v1': 'advice_policy',
  'terminology.v1': 'terminology',
  'citation_style.v1': 'citation_style',
} as const satisfies Record<RulesetPayloadSchema, string>

export async function insertOfficeRuleset(
  organizationId: string,
  input: RulesetValuesInput,
  context: { createdBy: string; provenance: KnowledgeProvenance; inForce: boolean }
): Promise<string> {
  const values = writableRuleset(input)
  const recordId = newRecordId('ruleset')
  await withTenant({ organizationId }, () =>
    getDb().transaction(async (tx) => {
      await tx
        .insert(knowledgeRecords)
        .values({ id: recordId, type: 'ruleset', organizationId, createdBy: context.createdBy })
      const revisionId = await appendRevision(
        tx,
        {
          organizationId,
          recordId,
          type: 'ruleset',
          createdBy: context.createdBy,
          provenance: context.provenance,
        },
        bodyOf(values)
      )
      if (context.inForce)
        await tx
          .update(knowledgeRecords)
          .set({ headRevisionId: revisionId })
          .where(eq(knowledgeRecords.id, recordId))
    })
  )
  return recordId
}

type RulesetRow = typeof knowledgeRulesetRevisions.$inferSelect

export function rulesetFromRow(row: RulesetRow): StoredRuleset | null {
  const parsed = rulesetValuesSchema.safeParse({
    purpose: row.purpose,
    territoryIds: row.territoryIds,
    workIds: row.workIds,
    validFrom: row.validFrom,
    validTo: row.validTo,
    basisEditionId: row.basisEditionId,
    body: row.inherits
      ? { kind: 'inherits', inherits: row.inherits }
      : {
          kind: row.payloadSchema ? KIND_OF_SCHEMA[row.payloadSchema] : undefined,
          payloadSchema: row.payloadSchema,
          payload: row.payload,
        },
  })
  return parsed.success ? { id: row.recordId, values: parsed.data } : null
}

export const SETUP_PURPOSES = ['fact_definitions', 'fact_sources', 'classification'] as const satisfies readonly RulesetPurpose[]

export interface RulesetRead {
  rulesets: StoredRuleset[]
  truncated: boolean
  unreadable: string[]
}

export async function readRulesetsInForce(
  organizationId: string,
  query: { purpose: RulesetPurpose; territoryIds: readonly string[] }
): Promise<RulesetRead> {
  if (query.territoryIds.length === 0) return { rulesets: [], unreadable: [], truncated: false }
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ body: knowledgeRulesetRevisions })
      .from(knowledgeRecords)
      .innerJoin(
        knowledgeRulesetRevisions,
        eq(knowledgeRulesetRevisions.revisionId, knowledgeRecords.headRevisionId)
      )
      .where(
        and(
          eq(knowledgeRecords.type, 'ruleset'),
          isNotNull(knowledgeRecords.headRevisionId),
          recordReadable('knowledge_records', organizationId),
          eq(knowledgeRulesetRevisions.purpose, query.purpose),
          sql`${knowledgeRulesetRevisions.territoryIds} && ${sql.param([...query.territoryIds])}::text[]`
        )
      )
      .orderBy(knowledgeRecords.id)
      .limit(MAX_RULESETS + 1)
  )
  const rulesets: StoredRuleset[] = []
  const unreadable: string[] = []
  for (const { body } of rows.slice(0, MAX_RULESETS)) {
    const ruleset = rulesetFromRow(body)
    if (ruleset) rulesets.push(ruleset)
    else unreadable.push(body.recordId)
  }
  return { rulesets, unreadable, truncated: rows.length > MAX_RULESETS }
}

export async function readSetupRulesetsInForce(organizationId: string): Promise<RulesetRead> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ body: knowledgeRulesetRevisions })
      .from(knowledgeRecords)
      .innerJoin(
        knowledgeRulesetRevisions,
        eq(knowledgeRulesetRevisions.revisionId, knowledgeRecords.headRevisionId)
      )
      .where(
        and(
          eq(knowledgeRecords.type, 'ruleset'),
          isNotNull(knowledgeRecords.headRevisionId),
          recordReadable('knowledge_records', organizationId),
          inArray(knowledgeRulesetRevisions.purpose, [...SETUP_PURPOSES])
        )
      )
      .orderBy(knowledgeRecords.id)
      .limit(MAX_RULESETS + 1)
  )
  const rulesets: StoredRuleset[] = []
  const unreadable: string[] = []
  for (const { body } of rows.slice(0, MAX_RULESETS)) {
    const ruleset = rulesetFromRow(body)
    if (ruleset) rulesets.push(ruleset)
    else unreadable.push(body.recordId)
  }
  return { rulesets, unreadable, truncated: rows.length > MAX_RULESETS }
}

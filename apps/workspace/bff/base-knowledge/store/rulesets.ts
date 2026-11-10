/**
 * The SQL of rulesets (migration 0204, ADR-0166): a ruleset is a base knowledge
 * record like a work or an edition, with its body in
 * `knowledge_ruleset_revisions`. No authorization here; callers decide first,
 * and every statement runs under its organization, so the layered RLS holds.
 *
 * Fail closed on both doors. A write parses the values and runs the table's
 * own examples before anything reaches the database; a read parses every
 * stored body again, and a body the current evaluator cannot read is left out
 * and reported, never half-run. Platform rulesets arrive with the platform
 * write path (design §4.4); an office reads them through the same query.
 */

import 'server-only'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
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

/** Most rulesets one read returns: a country has one per purpose and node, so this is generous. */
export const MAX_RULESETS = 500

/** A ruleset that cannot be written: invalid values, or a table its own examples contradict. */
export class RulesetRejectedError extends Error {
  override name = 'RulesetRejectedError'
}

/** Parse and test a ruleset before it is stored: the gate every write passes. */
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

/** The body kind each stored payload schema reads back as. */
const KIND_OF_SCHEMA = {
  'decision_table.v1': 'table',
  'fact_definitions.v1': 'fact_definitions',
  'fact_sources.v1': 'fact_sources',
  'advice_policy.v1': 'advice_policy',
  'terminology.v1': 'terminology',
} as const satisfies Record<RulesetPayloadSchema, string>

/**
 * An office's ruleset as one record with one revision. `inForce` moves the head
 * to it, which is what makes it count; without, it is a proposal.
 */
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

/** A stored body as the wire's values, or null when the current schema cannot read it. */
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

export interface RulesetRead {
  rulesets: StoredRuleset[]
  /** More than {@link MAX_RULESETS} matched: the read is incomplete, and a decision from it is not to be trusted. */
  truncated: boolean
  /** Records in force whose body the evaluator cannot read: a data error to report, not a rule to skip silently. */
  unreadable: string[]
}

/**
 * The rulesets in force for `purpose` on any of `territoryIds` that this
 * organization sees: its own and the platform's, each at its head. The caller
 * picks among them with `selectRuleset`.
 */
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

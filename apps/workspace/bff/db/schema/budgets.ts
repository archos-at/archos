import {
  bigint,
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const BUDGET_SCOPES = ['organization', 'member', 'project'] as const
export type BudgetScope = (typeof BUDGET_SCOPES)[number]

export const BUDGET_UNITS = ['credit', 'token'] as const
export type BudgetUnit = (typeof BUDGET_UNITS)[number]

export const BUDGET_POLICY_STATUSES = ['active', 'superseded'] as const
export type BudgetPolicyStatus = (typeof BUDGET_POLICY_STATUSES)[number]

export const budgetPolicies = pgTable(
  'budget_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    scope: text('scope').$type<BudgetScope>().notNull(),
    subjectId: text('subject_id'),
    dailyLimit: numeric('daily_limit', { precision: 12, scale: 4 }),
    monthlyLimit: numeric('monthly_limit', { precision: 12, scale: 4 }),
    currency: text('currency').$type<BudgetUnit>().notNull().default('credit'),
    status: text('status').$type<BudgetPolicyStatus>().notNull().default('active'),
    supersedesId: uuid('supersedes_id'),
    createdBy: text('created_by').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgScopeIdx: index('idx_budget_policies_org_scope').on(
      table.organizationId,
      table.scope,
      table.subjectId,
      table.status
    ),
  })
)

export const COST_SOURCES = ['usage_field', 'missing', 'generation_api', 'estimate'] as const
export type CostSource = (typeof COST_SOURCES)[number]

export const USAGE_ACTIVITIES = ['ingest', 'dictation'] as const
export type UsageActivity = (typeof USAGE_ACTIVITIES)[number]

export const UNBILLED_USAGE_ACTIVITIES: ReadonlySet<UsageActivity> = new Set(['dictation'])

export const INGEST_USAGE_ACTIVITY = 'ingest' satisfies UsageActivity

export const llmUsageEvents = pgTable(
  'llm_usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id'),
    projectId: text('project_id'),
    conversationId: text('conversation_id'),
    jobId: text('job_id'),
    messageId: text('message_id'),
    agentGroup: text('agent_group'),
    activity: text('activity').$type<UsageActivity>(),
    audioSeconds: numeric('audio_seconds', { precision: 10, scale: 2 }),
    requestedModel: text('requested_model'),
    model: text('model'),
    generationId: text('generation_id'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 14, scale: 8 }).notNull().default('0'),
    costSource: text('cost_source').$type<CostSource>().notNull().default('missing'),
    isByok: boolean('is_byok'),
    priceUsd: numeric('price_usd', { precision: 14, scale: 8 }).notNull().default('0'),
    credits: numeric('credits', { precision: 14, scale: 6 }).notNull().default('0'),
    pricingVersionId: uuid('pricing_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgTimeIdx: index('idx_llm_usage_events_org_time').on(table.organizationId, table.createdAt),
    orgUserTimeIdx: index('idx_llm_usage_events_org_user_time').on(
      table.organizationId,
      table.userId,
      table.createdAt
    ),
    orgProjectTimeIdx: index('idx_llm_usage_events_org_project_time').on(
      table.organizationId,
      table.projectId,
      table.createdAt
    ),
    orgModelTimeIdx: index('idx_llm_usage_events_org_model_time').on(
      table.organizationId,
      table.model,
      table.createdAt
    ),
    orgMessageIdx: index('idx_llm_usage_events_org_message').on(table.organizationId, table.messageId),
  })
)

export const llmUsageRollups = pgTable(
  'llm_usage_rollups',
  {
    organizationId: text('organization_id').notNull(),
    day: date('day').notNull(),
    userId: text('user_id').notNull().default(''),
    projectId: text('project_id').notNull().default(''),
    costUsd: numeric('cost_usd', { precision: 14, scale: 8 }).notNull().default('0'),
    priceUsd: numeric('price_usd', { precision: 14, scale: 8 }).notNull().default('0'),
    credits: numeric('credits', { precision: 14, scale: 6 }).notNull().default('0'),
    tokens: bigint('tokens', { mode: 'number' }).notNull().default(0),
    ingestCredits: numeric('ingest_credits', { precision: 14, scale: 6 }).notNull().default('0'),
    ingestTokens: bigint('ingest_tokens', { mode: 'number' }).notNull().default(0),
    ingestEvents: integer('ingest_events').notNull().default(0),
    ownKeyCostUsd: numeric('own_key_cost_usd', { precision: 14, scale: 8 }).notNull().default('0'),
    events: integer('events').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'llm_usage_rollups_pk',
      columns: [table.organizationId, table.day, table.userId, table.projectId],
    }),
    orgUserDayIdx: index('idx_llm_usage_rollups_org_user_day').on(
      table.organizationId,
      table.userId,
      table.day
    ),
    orgProjectDayIdx: index('idx_llm_usage_rollups_org_project_day').on(
      table.organizationId,
      table.projectId,
      table.day
    ),
  })
)

export type BudgetPolicy = typeof budgetPolicies.$inferSelect
export type NewBudgetPolicy = typeof budgetPolicies.$inferInsert
export type LlmUsageEvent = typeof llmUsageEvents.$inferSelect
export type NewLlmUsageEvent = typeof llmUsageEvents.$inferInsert
export type LlmUsageRollup = typeof llmUsageRollups.$inferSelect

import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { ASK_STATES, type AskState } from '@/lib/agent-asks/ask-wire'
import { conversations } from './conversations'

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

export const agentAsks = pgTable(
  'agent_asks',
  {
    id: uuid('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    state: text('state').$type<AskState>().notNull().default('submitted'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    conversationFk: foreignKey({
      name: 'agent_asks_conversation_fkey',
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [conversations.id, conversations.organizationId],
    }).onDelete('cascade'),
    requesterIdx: index('idx_agent_asks_requester_created').on(
      table.organizationId,
      table.requestedBy,
      table.createdAt,
    ),
    conversationIdx: index('idx_agent_asks_conversation').on(table.conversationId),
    openCreatedIdx: index('idx_agent_asks_open_created')
      .on(table.createdAt)
      .where(sql`${table.state} IN ('submitted', 'working')`),
    stateKnown: check('agent_asks_state_known', sql`${table.state} IN (${list(ASK_STATES)})`),
    reasonWhenRefused: check(
      'agent_asks_reason_when_refused',
      sql`(${table.state} IN ('failed', 'rejected')) = (${table.reason} IS NOT NULL)`,
    ),
    reasonLength: check(
      'agent_asks_reason_length',
      sql`${table.reason} IS NULL OR char_length(${table.reason}) BETWEEN 1 AND 500`,
    ),
    endedWhenTerminal: check(
      'agent_asks_ended_when_terminal',
      sql`(${table.state} IN ('submitted', 'working')) = (${table.endedAt} IS NULL)`,
    ),
  }),
)

export type AgentAskRow = typeof agentAsks.$inferSelect

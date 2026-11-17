import { sql, type SQL } from 'drizzle-orm'

export function answerIdOf(messageId: SQL): SQL {
  return sql`(case when ${messageId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (${messageId})::uuid end)`
}

export const VOTED_ANSWER_JOIN = sql`
    left join messages m
      on m.id = ${answerIdOf(sql`f.message_id`)}
     and m.role = 'assistant'
     and m.organization_id = f.organization_id
`

export const VOTED_QUESTION_JOIN = sql`
    left join lateral (
      select qm.content
      from messages qm
      where qm.conversation_id = m.conversation_id
        and qm.organization_id = m.organization_id
        and qm.role = 'user'
        and qm.created_at <= m.created_at
      order by qm.created_at desc
      limit 1
    ) q on true
`

export const VOTED_TURN_JOINS = sql`${VOTED_ANSWER_JOIN}${VOTED_QUESTION_JOIN}`

export function votedConversationId(feedback: {
  messageId: SQL
  conversationId: SQL
  organizationId: SQL
}): SQL {
  return sql`coalesce(
    (select am.conversation_id from messages am
      where am.id = ${answerIdOf(feedback.messageId)}
        and am.role = 'assistant'
        and am.organization_id = ${feedback.organizationId}),
    ${feedback.conversationId}
  )`
}

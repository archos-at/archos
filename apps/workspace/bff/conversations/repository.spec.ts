/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

interface CapturedQuery {
  sql: string
  params: unknown[]
}

const captured: CapturedQuery[] = []

let nextRows: unknown[][] = []

const proxyDb = drizzle(async (sql, params) => {
  captured.push({ sql, params })
  return { rows: nextRows }
})

const recordingDb = Object.assign(Object.create(proxyDb), {
  transaction: async <T>(run: (tx: typeof proxyDb) => Promise<T>): Promise<T> => run(proxyDb),
})

vi.mock('@/lib/db', () => ({ getDb: () => recordingDb }))

import {
  CONVERSATION_LIST_LIMIT,
  MESSAGE_LIST_LIMIT,
  deleteConversationInOrg,
  findConversationTenancy,
  findMessageInConversation,
  lastProjectActivityByUser,
  listMessagesForConversation,
  listVisibleConversations,
  upsertConversationRead,
  visibleConversationsWhere,
} from './repository'
import { conversations } from '@/lib/db/schema/conversations'

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function onlyQuery(): CapturedQuery {
  expect(captured).toHaveLength(1)
  return captured[0]
}

function messageRow(id: string, createdAt: string): unknown[] {
  return [id, 'conv_1', 'org_1', 'user', 'user_me', 'text', null, null, createdAt]
}

beforeEach(() => {
  captured.length = 0
  nextRows = []
})

describe('findConversationTenancy', () => {
  it.each([
    's_3f2504e0_4f89_11d3_9a0c_0305e82c3301',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  ])('resolves the text conversation identifier %s', async (conversationId) => {
    nextRows = [['org_1', PROJECT_ID, 'private', 'user_me', null]]

    expect(await findConversationTenancy(conversationId)).toEqual({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_me',
      deletedAt: null,
    })
    expect(onlyQuery().params).toEqual([conversationId, 1])
  })

  it('queries an unknown text identifier and reports its absence', async () => {
    expect(await findConversationTenancy('missing_conversation')).toBeNull()
    expect(onlyQuery().params).toEqual(['missing_conversation', 1])
  })
})

describe('listVisibleConversations — scoped to a project', () => {
  it('keeps org tenancy, and judges in-project and unstamped rows SEPARATELY', async () => {
    await listVisibleConversations('org_1', 'user_me', { projectId: PROJECT_ID })

    const { sql, params } = onlyQuery()
    expect(sql).toContain('"conversations"."organization_id" = $1')
    expect(sql).toContain('("conversations"."project_id" = $2 and (')
    expect(sql).toContain('or ("conversations"."project_id" is null and (')
    expect(params.slice(0, 2)).toEqual(['org_1', PROJECT_ID])
  })

  it('narrows ONLY private rows inside the project, because project access is proven', async () => {
    await listVisibleConversations('org_1', 'user_me', { projectId: PROJECT_ID })

    const { sql, params } = onlyQuery()
    expect(sql).toContain(
      '"conversations"."project_id" = $2 and ("conversations"."visibility" <> $3 or "conversations"."created_by" = $4',
    )
    expect(params).toContain('private')
  })

  it('does NOT hand an unstamped row out on `project` visibility alone (F5)', async () => {
    await listVisibleConversations('org_1', 'user_me', { projectId: PROJECT_ID })

    const { sql, params } = onlyQuery()
    expect(sql).toContain(
      '("conversations"."project_id" is null and ("conversations"."created_by" = $8 or exists (',
    )
    expect(sql).toContain('"conversations"."visibility" = $12')
    expect(params[11]).toBe('organization')
    expect(sql.match(/"conversations"\."visibility" <> /g)).toHaveLength(1)
  })

  it('resolves grants with ONE correlated subquery per branch, not one check per row', async () => {
    await listVisibleConversations('org_1', 'user_me', { projectId: PROJECT_ID })

    const { sql } = onlyQuery()
    expect(sql).toContain('exists (select 1 from "resource_shares"')
    expect(sql).toContain('"resource_shares"."resource_id" = "conversations"."id"')
    expect(sql).toContain('"resource_shares"."subject_user_id" = $7')
    expect(sql).toContain('"resource_shares"."subject_user_id" = $11')
    expect(sql).toContain('"resource_shares"."organization_id" = $5')
    expect(sql).toContain('"resource_shares"."resource_type" = $6')
  })

  it('is bounded, newest first', async () => {
    await listVisibleConversations('org_1', 'user_me', { projectId: PROJECT_ID })

    const { sql, params } = onlyQuery()
    expect(sql).toContain('order by "conversations"."updated_at" desc')
    expect(sql).toContain('limit $13')
    expect(params.at(-1)).toBe(CONVERSATION_LIST_LIMIT)
  })
})

describe('listVisibleConversations — no project scope', () => {
  it('returns only rows the caller owns, was granted, or that are org-visible', async () => {
    await listVisibleConversations('org_1', 'user_me')

    const { sql, params } = onlyQuery()
    expect(sql).toContain('"conversations"."organization_id" = $1')
    expect(sql).toContain('"conversations"."created_by" = $2')
    expect(sql).toContain('exists (select 1 from "resource_shares"')
    expect(sql).toContain('"conversations"."visibility" = $6')
    expect(params).toContain('organization')
    expect(sql).not.toContain('"conversations"."project_id"')
    expect(params).not.toContain('project')
  })
})

describe('visibleConversationsWhere — over the projects a search reaches', () => {
  const OTHER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3302'
  const statement = (projects: Parameters<typeof visibleConversationsWhere>[2]) =>
    recordingDb
      .select({ id: conversations.id })
      .from(conversations)
      .where(visibleConversationsWhere('org_1', 'user_me', projects))
      .toSQL()

  it('narrows only private rows inside the named projects, and judges unstamped rows on their own grounds', () => {
    const { sql, params } = statement({ projectIds: [PROJECT_ID, OTHER_ID], withoutContainer: true })
    expect(sql).toContain(
      '("conversations"."project_id" in ($2, $3) and ("conversations"."visibility" <> $4 or "conversations"."created_by" = $5'
    )
    expect(sql).toContain('or ("conversations"."project_id" is null and (')
    expect(params.slice(0, 3)).toEqual(['org_1', PROJECT_ID, OTHER_ID])
    expect(sql.match(/"conversations"\."visibility" <> /g)).toHaveLength(1)
  })

  it('leaves the unstamped rows out when asked to, and matches nothing for no project and no unstamped rows', () => {
    expect(statement({ projectIds: [PROJECT_ID], withoutContainer: false }).sql).not.toContain('is null')
    const none = statement({ projectIds: [], withoutContainer: false }).sql
    expect(none).toContain('false')
    expect(none).not.toContain('"conversations"."project_id"')
  })
})

describe('upsertConversationRead', () => {
  it('upserts on the (conversation, user) pair — one mark per person per thread', async () => {
    await upsertConversationRead({ conversationId: 'conv_1', userId: 'user_me' })

    const { sql } = onlyQuery()
    expect(sql).toContain('insert into "conversation_reads"')
    expect(sql).toContain('on conflict ("conversation_id","user_id") do update set')
  })

  it('keeps the stored anchor when the caller supplies no message id', async () => {
    await upsertConversationRead({ conversationId: 'conv_1', userId: 'user_me' })

    expect(onlyQuery().sql).toContain(
      '"last_read_message_id" = "conversation_reads"."last_read_message_id"',
    )
  })

  it('moves the anchor when one IS supplied', async () => {
    await upsertConversationRead({
      conversationId: 'conv_1',
      userId: 'user_me',
      lastReadMessageId: 'msg_9',
    })

    const { sql, params } = onlyQuery()
    expect(sql).not.toContain('"conversation_reads"."last_read_message_id"')
    expect(params).toContain('msg_9')
  })
})

describe('deleteConversationInOrg', () => {
  it('carries tenancy in the WHERE clause, not only in the service above it', async () => {
    await deleteConversationInOrg('conv_1', 'org_1')

    expect(captured).toHaveLength(4)
    expect(captured[3].sql).toContain('"conversation_source_projects"')
    expect(captured[3].params).toEqual(['org_1', 'conv_1'])
    const { sql, params } = captured[1]
    expect(sql).toContain('"conversations"."id" = $1')
    expect(sql).toContain('"conversations"."organization_id" = $2')
    expect(params).toEqual(['conv_1', 'org_1'])
  })

  it('takes the record of restricted source folders with the row, in the same organization (ADR-0087, ADR-0088)', async () => {
    await deleteConversationInOrg('conv_1', 'org_1')

    const { sql, params } = captured[2]
    expect(sql).toContain('delete from "conversation_restricted_folders"')
    expect(sql).toContain('"conversation_restricted_folders"."organization_id" = $1')
    expect(sql).toContain('"conversation_restricted_folders"."conversation_id" = $2')
    expect(params).toEqual(['org_1', 'conv_1'])
  })

  it('erases the votes cast on the chat, in the same organization, before its messages cascade away', async () => {
    await deleteConversationInOrg('conv_1', 'org_1')

    const { sql, params } = captured[0]
    expect(sql).toContain('delete from "answer_feedback"')
    expect(sql).toContain('"answer_feedback"."organization_id" = $1')
    expect(sql).toContain('"answer_feedback"."conversation_id" = $2')
    expect(sql).toContain('"answer_feedback"."message_id" in (select "messages"."id"::text from "messages"')
    expect(params).toEqual(['org_1', 'conv_1', 'conv_1', 'org_1'])
    expect(captured[1].sql).toContain('delete from "conversations"')
  })
})

describe('listMessagesForConversation', () => {
  it('takes the bounded window from the NEWEST end of the thread', async () => {
    await listMessagesForConversation('conv_1')

    const { sql, params } = onlyQuery()
    expect(sql).toContain('"messages"."conversation_id" = $1')
    expect(sql).toContain('order by "messages"."created_at" desc, "messages"."id" desc')
    expect(sql).toContain('limit $2')
    expect(params).toEqual(['conv_1', MESSAGE_LIST_LIMIT])
  })

  it('bounds an explicitly requested page the same way', async () => {
    await listMessagesForConversation('conv_1', 50)

    expect(onlyQuery().params).toEqual(['conv_1', 50])
  })

  it('hands the window back oldest-first, however it arrived', async () => {
    nextRows = [
      messageRow('msg_c', '2026-07-31T10:00:02.000Z'),
      messageRow('msg_b', '2026-07-31T10:00:01.000Z'),
      messageRow('msg_a', '2026-07-31T10:00:00.000Z'),
    ]

    const page = await listMessagesForConversation('conv_1', 3)

    expect(page.map((row) => row.id)).toEqual(['msg_a', 'msg_b', 'msg_c'])
    expect(page.map((row) => row.createdAt.toISOString())).toEqual([
      '2026-07-31T10:00:00.000Z',
      '2026-07-31T10:00:01.000Z',
      '2026-07-31T10:00:02.000Z',
    ])
  })

  it('breaks a created_at tie by id, so a tie straddling the cap is not a coin toss (CC-11)', async () => {
    const sameInstant = '2026-07-31T10:00:01.000Z'
    nextRows = [messageRow('msg_b', sameInstant), messageRow('msg_a', sameInstant)]

    const page = await listMessagesForConversation('conv_1', 2)

    expect(onlyQuery().sql).toContain('"messages"."created_at" desc, "messages"."id" desc')
    expect(page.map((row) => row.id)).toEqual(['msg_a', 'msg_b'])
  })
})

describe('findMessageInConversation', () => {
  it('is scoped by BOTH ids, so a guessed id from another thread reads as absent', async () => {
    await findMessageInConversation('conv_1', 'msg_1')

    const { sql, params } = onlyQuery()
    expect(sql).toContain('"messages"."id" = $1')
    expect(sql).toContain('"messages"."conversation_id" = $2')
    expect(params.slice(0, 2)).toEqual(['msg_1', 'conv_1'])
  })
})

describe('lastProjectActivityByUser', () => {
  const OTHER_PROJECT = '3f2504e0-4f89-11d3-9a0c-0305e82c3302'

  it('counts only messages this user wrote, plus their own legacy unauthored ones', async () => {
    await lastProjectActivityByUser('org_1', 'user_me', [PROJECT_ID])

    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"author_user_id" = \$\d+ or \("messages"\."author_user_id" is null/i)
    expect(sql).toMatch(/"messages"\."role" = \$\d+/i)
    expect(sql).toMatch(/"conversations"\."created_by" = \$\d+/i)
    expect(params).toContain('user')
    expect(params.filter((param) => param === 'user_me')).toHaveLength(2)
  })

  it('scopes to the organization, the requested projects, and live conversations', async () => {
    await lastProjectActivityByUser('org_1', 'user_me', [PROJECT_ID, OTHER_PROJECT])

    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"conversations"\."organization_id" = \$\d+/i)
    expect(sql).toMatch(/"conversations"\."project_id" in \(/i)
    expect(sql).toMatch(/"conversations"\."deleted_at" is null/i)
    expect(sql).toMatch(/group by "conversations"\."project_id"/i)
    expect(params).toContain('org_1')
    expect(params).toContain(PROJECT_ID)
    expect(params).toContain(OTHER_PROJECT)
  })

  it('coerces the aggregate at the boundary and keys it by project', async () => {
    nextRows = [
      [PROJECT_ID, '2026-08-05T09:00:00.000Z'],
      [OTHER_PROJECT, new Date('2026-08-01T07:30:00.000Z')],
    ]

    expect(await lastProjectActivityByUser('org_1', 'user_me', [PROJECT_ID, OTHER_PROJECT])).toEqual({
      [PROJECT_ID]: '2026-08-05T09:00:00.000Z',
      [OTHER_PROJECT]: '2026-08-01T07:30:00.000Z',
    })
  })

  it('drops an unparseable aggregate rather than emitting an Invalid Date', async () => {
    nextRows = [[PROJECT_ID, 'not-a-timestamp']]

    expect(await lastProjectActivityByUser('org_1', 'user_me', [PROJECT_ID])).toEqual({})
  })

  it('asks nothing when there are no projects to ask about', async () => {
    expect(await lastProjectActivityByUser('org_1', 'user_me', [])).toEqual({})
    expect(captured).toHaveLength(0)
  })
})

describe('findConversationTenancy — the probe sharing and the WebSocket gate stand on', () => {
  it('queries an app-minted `s_` id: the column is text, so no uuid guard may answer null for it', async () => {
    nextRows = [['org_1', null, 'private', 'user_me', null]]

    const row = await findConversationTenancy('s_7d1e2c3b_0000_4000_8000_00000000000c')

    expect(onlyQuery().params).toContain('s_7d1e2c3b_0000_4000_8000_00000000000c')
    expect(row).toMatchObject({ organizationId: 'org_1', visibility: 'private', createdBy: 'user_me' })
  })
})

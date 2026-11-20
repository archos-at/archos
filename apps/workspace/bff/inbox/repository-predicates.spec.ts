import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { getDb } from '@/lib/db'

describe('the SQL predicates behind the filters', () => {
  function render(condition: unknown): { sql: string; params: unknown[] } {
    const query = new PgDialect().sqlToQuery(condition as never)
    return { sql: query.sql, params: query.params }
  }

  async function realRepository() {
    return vi.importActual<typeof import('./repository')>('./repository')
  }

  it('the pending filter keeps unresolved actionable requests but drops read informational ones', async () => {
    let condition: unknown
    const limit = vi.fn().mockResolvedValue([])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn((value: unknown) => {
      condition = value
      return { orderBy }
    })
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) } as never)

    const real = await realRepository()
    await real.listInboxItems('org_1', 'user_1', {
      filter: 'pending',
      types: real.EVERY_INBOX_TYPE,
    })
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."organization_id" = $1')
    expect(sql).toContain('"inbox_items"."recipient_user_id" = $2')
    expect(sql).toContain('"inbox_items"."archived_at" is null')
    expect(sql).toContain('"inbox_items"."inert_at" is null')
    expect(sql).toContain(
      '"inbox_items"."read_at" is null or ("inbox_items"."actionable" = $3 and "inbox_items"."resolved_at" is null)',
    )
    expect(params).toEqual(['org_1', 'user_1', true])
  })

  it('resolves a settled request for ITS recipient only, never a colleague sharing the group key', async () => {
    let condition: unknown
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn((value: unknown) => {
      condition = value
      return { returning }
    })
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    } as never)

    const real = await realRepository()
    await real.resolveInboxItemsForTargets([
      {
        organizationId: 'org_1',
        recipientUserId: 'user_anna',
        groupKey: 'mention.requested:conversation:conv_1:msg_1',
      },
    ])
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."organization_id" = ')
    expect(sql).toContain('"inbox_items"."recipient_user_id" = ')
    expect(sql).toContain('"inbox_items"."resolved_at" is null')
    expect(params).toEqual([
      'org_1',
      'user_anna',
      'mention.requested:conversation:conv_1:msg_1',
    ])
  })

  it('marking a resource read clears ambient items only, never actionable ones', async () => {
    let condition: unknown
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn((value: unknown) => {
      condition = value
      return { returning }
    })
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    } as never)

    const real = await realRepository()
    await real.markResourceItemsRead('org_1', 'user_1', 'conversation', 'conv_1')
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."actionable" = $5')
    expect(sql).toContain('"inbox_items"."read_at" is null')
    expect(params).toEqual(['org_1', 'user_1', 'conversation', 'conv_1', false])
  })
})

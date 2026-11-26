// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

interface CapturedQuery {
  sql: string
  params: unknown[]
}

const captured: CapturedQuery[] = []

const proxyDb = drizzle(async (sql, params) => {
  captured.push({ sql, params })
  return { rows: [] }
})

vi.mock('@/lib/db', () => ({ getDb: () => proxyDb }))

import { findGrantForSubject } from './repository'

describe('findGrantForSubject — the deliberate non-org-scoped read', () => {
  it('has exactly ONE caller, and it is the access resolver that proved tenancy first', () => {
    const definition = 'bff/sharing/repository.ts'

    const callers = productionSources()
      .filter((file) => file !== definition)
      .filter((file) => nodesOf(parseSource(file), ts.isIdentifier).some((id) => id.text === 'findGrantForSubject'))

    expect(callers).toEqual(['bff/sharing/access.ts'])
  })

  it('is scoped by resource and subject only — the exception, stated in SQL', async () => {
    captured.length = 0

    await findGrantForSubject('conversation', 'conv_1', 'user_me')

    expect(captured).toHaveLength(1)
    const { sql, params } = captured[0]!
    expect(sql).toContain('"resource_shares"."resource_type" = $1')
    expect(sql).toContain('"resource_shares"."resource_id" = $2')
    expect(sql).toContain('"resource_shares"."subject_user_id" = $3')
    expect(sql).not.toContain('"resource_shares"."organization_id"')
    expect(params.slice(0, 3)).toEqual(['conversation', 'conv_1', 'user_me'])
  })

  it('scopes every OTHER read by organization, so the exception stays an exception', async () => {
    const repository = await import('./repository')

    captured.length = 0
    await repository.listGrantsForResource('org_1', 'conversation', 'conv_1')
    await repository.listResourceIdsSharedWith('org_1', 'user_me', 'conversation')
    await repository.listGrantsForResources('org_1', 'conversation', ['conv_1'])

    expect(captured).toHaveLength(3)
    for (const query of captured) {
      expect(query.sql).toContain('"resource_shares"."organization_id" = $1')
      expect(query.params[0]).toBe('org_1')
    }
  })
})

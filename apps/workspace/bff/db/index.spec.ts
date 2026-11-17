/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const driver = vi.hoisted(() => {
  const calls: { options?: Record<string, unknown>; url?: string; transactions: string[][] } = { transactions: [] }
  const connection = {
    unsafe: vi.fn(async (query: string) => {
      calls.transactions[calls.transactions.length - 1].push(query)
      return []
    }),
  }
  const client = {
    options: { parsers: {}, serializers: {} },
    begin: vi.fn(async (fn: (c: typeof connection) => Promise<unknown>) => {
      calls.transactions.push([])
      return fn(connection)
    }),
    end: vi.fn(async () => undefined),
  }
  const postgres = vi.fn((url: string, options: Record<string, unknown>) => {
    calls.url = url
    calls.options = options
    return client
  })
  return { calls, client, postgres }
})

vi.mock('postgres', () => ({ default: driver.postgres }))

import { closeDb, contextStatement, createDb, resolveDbPoolMax } from './index'
import { withPlatformAccess, withTenant } from './tenant-context'

describe('resolveDbPoolMax', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to 10 when DB_POOL_MAX is unset', () => {
    vi.stubEnv('DB_POOL_MAX', '')
    expect(resolveDbPoolMax()).toBe(10)
  })

  it('honours a valid positive override', () => {
    vi.stubEnv('DB_POOL_MAX', '25')
    expect(resolveDbPoolMax()).toBe(25)
  })

  it('floors a fractional value to an integer connection count', () => {
    vi.stubEnv('DB_POOL_MAX', '12.9')
    expect(resolveDbPoolMax()).toBe(12)
  })

  it('falls back to the default rather than disabling the bound on non-positive input', () => {
    vi.stubEnv('DB_POOL_MAX', '0')
    expect(resolveDbPoolMax()).toBe(10)
    vi.stubEnv('DB_POOL_MAX', '-5')
    expect(resolveDbPoolMax()).toBe(10)
  })

  it('falls back to the default on unparseable input', () => {
    vi.stubEnv('DB_POOL_MAX', 'not-a-number')
    expect(resolveDbPoolMax()).toBe(10)
  })
})

describe('contextStatement', () => {
  const TIMEOUT = "SET LOCAL statement_timeout = '30000'"

  it('sets the tenant, the user and the statement timeout in one batch', () => {
    const batch = contextStatement({ kind: 'tenant', organizationId: 'org_01H', userId: 'user_01H' })

    expect(batch).toBe(
      `SET LOCAL "grid.organization_id" = 'org_01H'; SET LOCAL "grid.user_id" = 'user_01H'; ${TIMEOUT}`
    )
  })

  it('gives a tenant with no user an empty user, which no row policy matches', () => {
    expect(contextStatement({ kind: 'tenant', organizationId: 'org_01H', userId: null })).toContain(
      `SET LOCAL "grid.user_id" = ''`
    )
  })

  it('steps a platform scope up first and still sets the statement timeout', () => {
    const batch = contextStatement({ kind: 'platform', reason: 'test' })

    expect(batch).toBe(`SET LOCAL ROLE app_platform; ${TIMEOUT}`)
    expect(batch.startsWith('SET LOCAL ROLE')).toBe(true)
  })

  it('refuses an organization that is not a plain identifier, before anything is sent', () => {
    expect(() => contextStatement({ kind: 'tenant', organizationId: "org'; DROP TABLE x; --", userId: null })).toThrow(
      /not a plain identifier/
    )
  })
})

describe('the BFF client behind a transaction pooler', () => {
  beforeEach(async () => {
    vi.stubEnv('APP_DATABASE_URL', 'postgresql://app_rw:pw@grid-pg-pooler-rw:5432/app?sslmode=require')  // pragma: allowlist secret
    await closeDb()
    driver.calls.transactions.length = 0
    driver.postgres.mockClear()
    createDb()
  })

  afterEach(async () => {
    await closeDb()
    vi.unstubAllEnvs()
  })

  it('opens connections with no startup parameters of its own', () => {
    expect(driver.calls.options).not.toHaveProperty('connection')
    expect(driver.calls.options).toMatchObject({ prepare: false })
  })

  it('applies the context and the timeout as the first statement of a tenant statement’s transaction', async () => {
    const db = createDb()

    await withTenant({ organizationId: 'org_01H', userId: 'user_01H' }, () => db.$client.unsafe('select 1', []))

    expect(driver.calls.transactions).toEqual([
      [
        `SET LOCAL "grid.organization_id" = 'org_01H'; SET LOCAL "grid.user_id" = 'user_01H'; SET LOCAL statement_timeout = '30000'`,
        'select 1',
      ],
    ])
  })

  it('does the same for a platform statement', async () => {
    const db = createDb()

    await withPlatformAccess('test', () => db.$client.unsafe('select 1', []))

    expect(driver.calls.transactions).toEqual([
      [`SET LOCAL ROLE app_platform; SET LOCAL statement_timeout = '30000'`, 'select 1'],
    ])
  })

  it('applies it to an explicit transaction once, covering every statement in it', async () => {
    const db = createDb()

    await withTenant({ organizationId: 'org_01H', userId: null }, () =>
      db.$client.begin(async (tx) => {
        await tx.unsafe('select 1')
        await tx.unsafe('select 2')
      })
    )

    const [transaction] = driver.calls.transactions
    expect(transaction).toHaveLength(3)
    expect(transaction[0]).toContain("SET LOCAL statement_timeout = '30000'")
    expect(transaction.slice(1)).toEqual(['select 1', 'select 2'])
  })

  it('sends no statement outside a transaction that has the timeout', async () => {
    const db = createDb()

    await withTenant({ organizationId: 'org_01H', userId: null }, async () => {
      await db.$client.unsafe('select 1', [])
      await db.$client.unsafe('select 2', [])
    })

    expect(driver.calls.transactions).toHaveLength(2)
    for (const transaction of driver.calls.transactions) {
      expect(transaction[0]).toContain("SET LOCAL statement_timeout = '30000'")
    }
  })
})

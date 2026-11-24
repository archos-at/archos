/**
 * @vitest-environment node
 */

import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_side_${STAMP}`
const OTHER_ORG = `org_side_other_${STAMP}`
const ME = `user_side_me_${STAMP}`
const COLLEAGUE = `user_side_colleague_${STAMP}`
const PERSONAL = `s_side_personal_${STAMP}`
const IN_PROJECT = `s_side_project_${STAMP}`

const codeOf = async (work: PromiseLike<unknown>): Promise<string | undefined> => {
  try {
    await work
    return undefined
  } catch (error) {
    let cause: unknown = error
    while (cause && typeof cause === 'object') {
      const code = (cause as { code?: unknown }).code
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
      cause = (cause as { cause?: unknown }).cause
    }
    return 'unknown'
  }
}

describe.skipIf(!url)('a chat’s side is fixed in the database, whatever the application writes (ADR-0193)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let projectId = ''
  let otherOfficeProject = ''
  let messageId = ''

  const asMe = <T>(fn: () => PromiseLike<T>) => withTenant({ organizationId: ORG, userId: ME }, fn)

  async function project(organizationId: string, name: string): Promise<string> {
    const [row] = Array.from(
      await withTenant({ organizationId, userId: ME }, () =>
        db.execute<{ id: string }>(sql`
          insert into projects (organization_id, name, created_by, collection_name)
          values (${organizationId}, ${name}, ${ME}, ${`proj_side_${name}_${STAMP}`}) returning id`)
      )
    )
    return String(row.id)
  }

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    db = (await import('@/lib/db')).getDb()
    ;({ withTenant } = await import('@/lib/db/tenant-context'))
    projectId = await project(ORG, 'holzbau')
    otherOfficeProject = await project(OTHER_ORG, 'fremd')
    await asMe(() =>
      db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, project_id, started_in_personal)
        values (${PERSONAL}, ${ORG}, ${ME}, 'dere', null, true),
               (${IN_PROJECT}, ${ORG}, ${ME}, 'Holzbau', ${projectId}, false)`)
    )
    const [message] = Array.from(
      await asMe(() =>
        db.execute<{ id: string }>(sql`
          insert into messages (conversation_id, role, content) values (${PERSONAL}, 'user', 'wie gehts') returning id`)
      )
    )
    messageId = String(message.id)
  })

  it('a personal chat cannot be moved into a project', async () => {
    expect(await codeOf(asMe(() => db.execute(sql`update conversations set project_id = ${projectId} where id = ${PERSONAL}`)))).toBe('GSD01')
  })

  it('a project’s chat cannot be moved to Persönlich or marked as started there', async () => {
    expect(await codeOf(asMe(() => db.execute(sql`update conversations set project_id = null where id = ${IN_PROJECT}`)))).toBe('GSD01')
    expect(await codeOf(asMe(() => db.execute(sql`update conversations set started_in_personal = true where id = ${IN_PROJECT}`)))).toBe('GSD01')
  })

  it('a chat cannot be handed to another person', async () => {
    expect(await codeOf(asMe(() => db.execute(sql`update conversations set created_by = ${COLLEAGUE} where id = ${PERSONAL}`)))).toBe('GSD01')
  })

  it('a message cannot be moved from a personal chat into a project’s chat', async () => {
    expect(await codeOf(asMe(() => db.execute(sql`update messages set conversation_id = ${IN_PROJECT} where id = ${messageId}`)))).toBe('GSD01')
  })

  it('a chat started in Persönlich cannot be created with a project', async () => {
    const id = `s_side_bad_${STAMP}`
    expect(
      await codeOf(
        asMe(() =>
          db.execute(sql`
            insert into conversations (id, organization_id, created_by, title, project_id, started_in_personal)
            values (${id}, ${ORG}, ${ME}, 'x', ${projectId}, true)`)
        )
      )
    ).toBe('23514')
  })

  it('a chat cannot be created under another office’s project (the tenant policy)', async () => {
    const id = `s_side_foreign_${STAMP}`
    expect(
      await codeOf(
        asMe(() =>
          db.execute(sql`
            insert into conversations (id, organization_id, created_by, title, project_id)
            values (${id}, ${ORG}, ${ME}, 'x', ${otherOfficeProject})`)
        )
      )
    ).toBe('42501')
  })

  it('what may change still changes: the title, and the chat is deleted with its project', async () => {
    expect(await codeOf(asMe(() => db.execute(sql`update conversations set title = 'Holzbau Wien' where id = ${IN_PROJECT}`)))).toBeUndefined()
    expect(await codeOf(asMe(() => db.execute(sql`delete from projects where id = ${projectId}`)))).toBeUndefined()
    const left = Array.from(await asMe(() => db.execute<{ id: string }>(sql`select id from conversations where id = ${IN_PROJECT}`)))
    expect(left).toEqual([])
  })
})

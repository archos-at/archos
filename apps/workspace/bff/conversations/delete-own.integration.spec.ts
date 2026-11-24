/**
 * @vitest-environment node
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_delown_${STAMP}`
const OTHER_ORG = `org_delown_other_${STAMP}`
const ME = `user_delown_me_${STAMP}`
const COLLEAGUE = `user_delown_colleague_${STAMP}`

const MINE_PERSONAL = `s_delown_mine_personal_${STAMP}`
const MINE_PERSONAL_2 = `s_delown_mine_personal2_${STAMP}`
const MINE_HELD = `s_delown_mine_held_${STAMP}`
const MINE_IN_A = `s_delown_mine_a_${STAMP}`
const MINE_IN_B = `s_delown_mine_b_${STAMP}`
const MINE_ALREADY_DELETING = `s_delown_mine_deleting_${STAMP}`
const COLLEAGUE_PERSONAL_SHARED = `s_delown_colleague_shared_${STAMP}`
const COLLEAGUE_IN_A = `s_delown_colleague_a_${STAMP}`
const OTHER_ORG_MINE = `s_delown_other_org_${STAMP}`
const MINE_LEGACY = `s_delown_mine_legacy_${STAMP}`

type Row = { id: string; deleted_at: Date | null }

describe.skipIf(!url)('deleting all of one side of my chats against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let repo: typeof import('./repository') & typeof import('./own-conversations-repository')
  let projectA = ''
  let projectB = ''

  const asMe = <T>(fn: () => PromiseLike<T>) => withTenant({ organizationId: ORG, userId: ME }, fn)

  async function deletedIds(): Promise<string[]> {
    const rows = await withPlatformAccess('test: read conversations', () =>
      db.execute<Row>(sql`select id, deleted_at from conversations where organization_id in (${ORG}, ${OTHER_ORG})`)
    )
    return Array.from(rows)
      .filter((row) => row.deleted_at !== null)
      .map((row) => row.id)
      .sort()
  }

  async function queued(): Promise<string[]> {
    const rows = await withPlatformAccess('test: read queue', () =>
      db.execute<{ entity_id: string }>(sql`
        select entity_id from deletion_queue
         where entity_type = 'conversation' and organization_id in (${ORG}, ${OTHER_ORG})`)
    )
    return Array.from(rows)
      .map((row) => row.entity_id)
      .sort()
  }

  async function project(name: string): Promise<string> {
    const [row] = Array.from(
      await asMe(() =>
        db.execute<{ id: string }>(sql`
          insert into projects (organization_id, name, created_by, collection_name)
          values (${ORG}, ${name}, ${ME}, ${`proj_delown_${name}_${STAMP}`}) returning id`)
      )
    )
    return String(row.id)
  }

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    repo = { ...(await import('./repository')), ...(await import('./own-conversations-repository')) }
    db = (await import('@/lib/db')).getDb()

    await withPlatformAccess('test seed: organizations', () =>
      db.execute(sql`
        insert into organizations (workos_organization_id, display_name)
        values (${ORG}, ${ORG}), (${OTHER_ORG}, ${OTHER_ORG}) on conflict do nothing`)
    )
    projectA = await project('a')
    projectB = await project('b')
  })

  beforeEach(async () => {
    await withPlatformAccess('test: reset', async () => {
      await db.execute(sql`delete from legal_holds where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from deletion_queue where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from conversations where organization_id in (${ORG}, ${OTHER_ORG})`)
    })
    await asMe(() =>
      db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, project_id, visibility, deleted_at, started_in_personal) values
          (${MINE_PERSONAL}, ${ORG}, ${ME}, 'Was sagt § 50 Wiener Garagengesetz?', null, 'private', null, true),
          (${MINE_PERSONAL_2}, ${ORG}, ${ME}, 'OIB-Richtlinie 2 und 2.3', null, 'private', null, true),
          (${MINE_HELD}, ${ORG}, ${ME}, 'Gehalten', null, 'private', null, true),
          (${MINE_LEGACY}, ${ORG}, ${ME}, 'Alte Startseite', null, 'private', null, false),
          (${MINE_IN_A}, ${ORG}, ${ME}, 'Projekt A', ${projectA}, 'private', null, false),
          (${MINE_IN_B}, ${ORG}, ${ME}, 'Projekt B', ${projectB}, 'project', null, false),
          (${MINE_ALREADY_DELETING}, ${ORG}, ${ME}, 'Schon gelöscht', null, 'private', now() - interval '1 hour', true),
          (${COLLEAGUE_PERSONAL_SHARED}, ${ORG}, ${COLLEAGUE}, 'Geteilt', null, 'organization', null, true),
          (${COLLEAGUE_IN_A}, ${ORG}, ${COLLEAGUE}, 'Kollege in A', ${projectA}, 'project', null, false)
      `)
    )
    await withTenant({ organizationId: OTHER_ORG, userId: ME }, () =>
      db.execute(sql`
        insert into conversations (id, organization_id, created_by, title)
        values (${OTHER_ORG_MINE}, ${OTHER_ORG}, ${ME}, 'Andere Organisation')`)
    )
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from legal_holds where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from deletion_queue where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from conversations where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from projects where organization_id = ${ORG}`)
      await db.execute(sql`delete from organizations where workos_organization_id in (${ORG}, ${OTHER_ORG})`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('Persönlich lists neither an old chat without a project nor offers it to delete-all; the row stays', async () => {
    const listed = await asMe(() => repo.listVisibleConversations(ORG, ME, { place: 'personal' }))
    const everywhere = await asMe(() => repo.listVisibleConversations(ORG, ME))
    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    expect(listed.map((row) => row.id)).not.toContain(MINE_LEGACY)
    expect(everywhere.map((row) => row.id)).not.toContain(MINE_LEGACY)
    expect(result.marked.map((row) => row.id)).not.toContain(MINE_LEGACY)
    expect(await deletedIds()).not.toContain(MINE_LEGACY)
    const kept = await withPlatformAccess('test: read legacy', () =>
      db.execute<{ id: string }>(sql`select id from conversations where id = ${MINE_LEGACY}`)
    )
    expect(Array.from(kept)).toHaveLength(1)
  })

  it('a chat created with the Persönlich mark is listed there at once', async () => {
    const fresh = `s_delown_fresh_${STAMP}`
    await asMe(() =>
      repo.insertConversation({ id: fresh, organizationId: ORG, createdBy: ME, title: null, projectId: null, startedInPersonal: true })
    )

    const listed = await asMe(() => repo.listVisibleConversations(ORG, ME, { place: 'personal' }))

    expect(listed.map((row) => row.id)).toContain(fresh)
  })

  it('Persönlich marks only my chats without a project, and queues each erasure', async () => {
    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    const expected = [MINE_HELD, MINE_PERSONAL, MINE_PERSONAL_2].sort()
    expect(result.marked.map((row) => row.id).sort()).toEqual(expected)
    expect(result.held).toEqual([])
    expect(await deletedIds()).toEqual([MINE_ALREADY_DELETING, ...expected].sort())
    expect(await queued()).toEqual(expected)
  })

  it('a project marks only my chats in that project: not my other project, not my personal ones, not a colleague’s', async () => {
    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: projectA }))

    expect(result.marked.map((row) => row.id)).toEqual([MINE_IN_A])
    expect(await deletedIds()).toEqual([MINE_ALREADY_DELETING, MINE_IN_A].sort())
  })

  it('reports a held chat and leaves it, while the rest of the side is marked', async () => {
    await withPlatformAccess('test: hold', () =>
      db.execute(sql`
        insert into legal_holds (entity_type, entity_id, organization_id, reason, created_by)
        values ('conversation', ${MINE_HELD}, ${ORG}, 'integration test', ${COLLEAGUE})`)
    )

    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    expect(result.held).toEqual([{ id: MINE_HELD, title: 'Gehalten' }])
    expect(result.marked.map((row) => row.id).sort()).toEqual([MINE_PERSONAL, MINE_PERSONAL_2].sort())
    expect(await deletedIds()).not.toContain(MINE_HELD)
    expect(await queued()).not.toContain(MINE_HELD)
  })

  it('a hold on me as a person keeps every chat I started and marks none', async () => {
    await withPlatformAccess('test: custodian hold', () =>
      db.execute(sql`
        insert into legal_holds (entity_type, entity_id, organization_id, reason, created_by)
        values ('user', ${ME}, ${ORG}, 'integration test', ${COLLEAGUE})`)
    )

    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    expect(result.marked).toEqual([])
    expect(result.held.map((row) => row.id).sort()).toEqual([MINE_HELD, MINE_PERSONAL, MINE_PERSONAL_2].sort())
    expect(await deletedIds()).toEqual([MINE_ALREADY_DELETING])
  })

  it('the erase job reads back exactly the chats this delete marked', async () => {
    const result = await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    const first = await asMe(() =>
      repo.listMarkedOwnConversationIds(ORG, ME, result.markedAt, { after: null, limit: 2 })
    )
    const rest = await asMe(() =>
      repo.listMarkedOwnConversationIds(ORG, ME, result.markedAt, { after: first.at(-1) ?? null, limit: 2 })
    )

    expect([...first, ...rest].sort()).toEqual(result.marked.map((row) => row.id).sort())
    expect([...first, ...rest]).not.toContain(MINE_ALREADY_DELETING)
  })

  it('my listing no longer shows a marked chat while its erasure is still to come', async () => {
    await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    const listed = await asMe(() => repo.listVisibleConversations(ORG, ME, { place: 'personal' }))

    expect(listed.map((row) => row.id).sort()).toEqual([COLLEAGUE_PERSONAL_SHARED])
  })

  it('never reaches a chat of mine in another organization', async () => {
    await asMe(() => repo.markOwnConversationsDeleting(ORG, ME, { projectId: null }))

    expect(await deletedIds()).not.toContain(OTHER_ORG_MINE)
  })
})

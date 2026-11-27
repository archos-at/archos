/**
 * @vitest-environment node
 *
 * A chat without a project against a REAL Postgres, through the restricted
 * runtime role (migration 0269, ADR-0193 amendment „A personal chat is read by
 * its owner“): its creator, the people it is shared with and a named system
 * reader read it and what hangs on it; a colleague, an administrator and a
 * context with no person read and write none of it, whatever the query says.
 * A chat in a project keeps the organization's policy.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('@/lib/session-documents/cleanup', () => ({
  purgeSessionDocuments: vi.fn(async () => ({ ok: true, retained: 0, failures: [] })),
  deleteSessionCollection: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/conversations/working-directory', () => ({
  discardConversationDrafts: vi.fn(async () => true),
}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_personal_chat_${STAMP}`
const OWNER = `user_pc_owner_${STAMP}`
const GRANTEE = `user_pc_grantee_${STAMP}`
const COLLEAGUE = `user_pc_colleague_${STAMP}`
const ADMIN = `user_pc_admin_${STAMP}`

const CHAT = `s_pc_chat_${STAMP}`
const PROJECT_CHAT = `s_pc_project_${STAMP}`
const ERASED_CHAT = `s_pc_erased_${STAMP}`
const TEMPORARY_CHAT = `s_pc_temporary_${STAMP}`
const QUESTION = randomUUID()
const ANSWER = randomUUID()
const PROJECT_MESSAGE = randomUUID()
const FOLDER = randomUUID()
const SESSION_DOCUMENT = randomUUID()
const SESSION_VERSION = randomUUID()
const BATCH = randomUUID()
const ASK = randomUUID()
const TOKEN = 'personal-chat-spec-token'

const CHILDREN = [
  ['messages', sql`select id::text as id from messages where conversation_id = ${CHAT}`],
  ['conversation_reads', sql`select user_id as id from conversation_reads where conversation_id = ${CHAT}`],
  ['conversation_restricted_folders', sql`select folder_id::text as id from conversation_restricted_folders where conversation_id = ${CHAT}`],
  ['conversation_source_projects', sql`select project_id::text as id from conversation_source_projects where conversation_id = ${CHAT}`],
  ['message_restricted_use', sql`select message_id as id from message_restricted_use where conversation_id = ${CHAT}`],
  ['answer_contexts', sql`select message_id as id from answer_contexts where conversation_id = ${CHAT}`],
  ['agent_asks', sql`select id::text as id from agent_asks where conversation_id = ${CHAT}`],
  ['answer_feedback', sql`select message_id as id from answer_feedback where conversation_id = ${CHAT}`],
  ['session documents', sql`select id::text as id from documents where conversation_id = ${CHAT}`],
  ['their versions', sql`select id::text as id from document_versions where document_id = ${SESSION_DOCUMENT}`],
  ['upload_batches', sql`select id::text as id from upload_batches where conversation_id = ${CHAT}`],
] as const

describe('the personal chat suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the personal chat suite skipped ' +
        'and nothing verified that a colleague cannot read someone else’s chat. Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('a chat without a project against live Postgres (migration 0269)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let context: typeof import('@/lib/db/tenant-context')
  let projectId = ''

  const as = <T>(userId: string | null, run: () => Promise<T>): Promise<T> =>
    context.withTenant({ organizationId: ORG, userId }, run)
  const asReader = <T>(reader: import('@/lib/db/tenant-context').SystemReader, run: () => Promise<T>): Promise<T> =>
    context.withSystemReader(ORG, reader, run)
  const rows = async (run: <T>(fn: () => Promise<T>) => Promise<T>, query: ReturnType<typeof sql>): Promise<string[]> =>
    [...(await run(() => db.execute(query)))].map((row) => String(row.id)).sort()
  const ids = (userId: string | null, query: ReturnType<typeof sql>) => rows((fn) => as(userId, fn), query)
  const platformIds = (query: ReturnType<typeof sql>) => rows((fn) => context.withPlatformAccess('personal chat spec', fn), query)
  const sessionOf = (userId: string) => ({ organizationId: ORG, userId }) as unknown as AuthorizedSession
  const audienceVersion = async (): Promise<number> => {
    const [row] = [...(await context.withPlatformAccess('spec: audience', () =>
      db.execute(sql`select audience_version from conversations where id = ${CHAT}`)))]
    return Number(row?.audience_version)
  }
  const refusal = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run()
      return 'went through'
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause
      return cause instanceof Error ? cause.message : String(error)
    }
  }
  const internalRequest = (path: string, body: unknown) =>
    new Request(`https://example.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    vi.stubEnv('INTERNAL_API_TOKEN', TOKEN)
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()

    await context.withPlatformAccess('spec seed: organization', () =>
      db.execute(sql`insert into organizations (workos_organization_id, display_name) values (${ORG}, ${ORG}) on conflict do nothing`)
    )
    await as(OWNER, async () => {
      const [project] = [...(await db.execute(sql`
        insert into projects (organization_id, name, created_by, collection_name)
        values (${ORG}, 'Wohnhaus Huber', ${OWNER}, ${`proj_pc_${STAMP}`}) returning id`))]
      projectId = String(project.id)
      await db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, started_in_personal)
        values (${CHAT}, ${ORG}, ${OWNER}, 'Anfrage Huber vor Projektstart', true)`)
      await db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, project_id, visibility)
        values (${PROJECT_CHAT}, ${ORG}, ${OWNER}, 'Projektchat', ${projectId}, 'project')`)
      await db.execute(sql`
        insert into messages (id, conversation_id, organization_id, role, author_user_id, content) values
          (${QUESTION}, ${CHAT}, ${ORG}, 'user', ${OWNER}, 'Was darf ich auf dem Grundstück bauen?'),
          (${ANSWER}, ${CHAT}, ${ORG}, 'assistant', null, 'Bebauungsplan prüfen.'),
          (${PROJECT_MESSAGE}, ${PROJECT_CHAT}, ${ORG}, 'user', ${OWNER}, 'Für das Team.')`)
      await db.execute(sql`insert into conversation_reads (conversation_id, organization_id, user_id) values (${CHAT}, ${ORG}, ${OWNER})`)
      await db.execute(sql`
        insert into conversation_restricted_folders (organization_id, conversation_id, folder_id) values (${ORG}, ${CHAT}, ${FOLDER})`)
      await db.execute(sql`
        insert into conversation_source_projects (organization_id, conversation_id, project_id) values (${ORG}, ${CHAT}, ${projectId})`)
      await db.execute(sql`
        insert into answer_contexts (organization_id, message_id, conversation_id, user_id, kind, solo, other_projects, workspace_read, personal_memory, personal_shelf)
        values (${ORG}, ${ANSWER}, ${CHAT}, ${OWNER}, 'chat', true, 'none', 'all', true, true)`)
      await db.execute(sql`insert into agent_asks (id, organization_id, conversation_id, requested_by) values (${ASK}, ${ORG}, ${CHAT}, ${OWNER})`)
      await db.execute(sql`
        insert into answer_feedback (organization_id, conversation_id, message_id, user_id, verdict, comment)
        values (${ORG}, ${CHAT}, ${ANSWER}, ${OWNER}, 'down', 'Falsche Bauklasse')`)
      await db.execute(sql`
        insert into documents (id, organization_id, scope, conversation_id, created_by, filename, storage_key, collection_name)
        values (${SESSION_DOCUMENT}, ${ORG}, 'session', ${CHAT}, ${OWNER}, 'Lageplan Huber.pdf', 'k/pc/1', ${`session_${CHAT}`})`)
      await db.execute(sql`
        insert into document_versions (id, organization_id, document_id, version_number, storage_key, created_by)
        values (${SESSION_VERSION}, ${ORG}, ${SESSION_DOCUMENT}, 1, 'k/pc/1', ${OWNER})`)
      await db.execute(sql`
        insert into upload_batches (id, organization_id, created_by, scope, conversation_id, expected_count)
        values (${BATCH}, ${ORG}, ${OWNER}, 'session', ${CHAT}, 1)`)
    })
  })

  afterAll(async () => {
    if (!db) return
    await context.withPlatformAccess('spec teardown', async () => {
      await db.execute(sql`delete from resource_shares where organization_id = ${ORG}`)
      await db.execute(sql`delete from deletion_queue where organization_id = ${ORG}`)
      await db.execute(sql`delete from answer_feedback where organization_id = ${ORG}`)
      await db.execute(sql`delete from answer_contexts where organization_id = ${ORG}`)
      await db.execute(sql`delete from conversation_restricted_folders where organization_id = ${ORG}`)
      await db.execute(sql`delete from conversation_source_projects where organization_id = ${ORG}`)
      await db.execute(sql`delete from message_restricted_use where organization_id = ${ORG}`)
      await db.execute(sql`delete from upload_batches where organization_id = ${ORG}`)
      await db.execute(sql`delete from documents where organization_id = ${ORG}`)
      await db.execute(sql`delete from conversations where organization_id = ${ORG}`)
      await db.execute(sql`delete from projects where organization_id = ${ORG}`)
      await db.execute(sql`delete from organizations where workos_organization_id = ${ORG}`)
    })
    vi.unstubAllEnvs()
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('shows its creator the chat and everything that hangs on it', async () => {
    expect(await ids(OWNER, sql`select id from conversations where id = ${CHAT}`)).toEqual([CHAT])
    for (const [table, query] of CHILDREN) {
      expect(await ids(OWNER, query), table).not.toEqual([])
    }
  })

  it.each([
    ['a colleague', COLLEAGUE],
    ['an administrator, who is a person like any other here', ADMIN],
    ['a context with neither a person nor a named system reader', null],
  ])('shows %s none of it, whatever the WHERE names', async (_who, reader) => {
    expect(await ids(reader, sql`select id from conversations where id in (${CHAT}, ${PROJECT_CHAT}) order by id`)).toEqual([PROJECT_CHAT])
    for (const [table, query] of CHILDREN) {
      expect(await ids(reader, query), table).toEqual([])
    }
  })

  it('lets nobody else write into it, rename it or delete it: an insert is refused, a change matches no row', async () => {
    expect(
      await refusal(() =>
        as(COLLEAGUE, () =>
          db.execute(sql`insert into messages (conversation_id, organization_id, role, content) values (${CHAT}, ${ORG}, 'user', 'planted')`)
        )
      )
    ).toMatch(/row-level security/)
    await as(COLLEAGUE, () => db.execute(sql`update conversations set title = 'taken' where id = ${CHAT}`))
    await as(COLLEAGUE, () => db.execute(sql`delete from messages where conversation_id = ${CHAT}`))
    await as(ADMIN, () => db.execute(sql`delete from conversations where id = ${CHAT}`))
    expect(await ids(OWNER, sql`select id from conversations where title = 'Anfrage Huber vor Projektstart'`)).toEqual([CHAT])
    expect(await ids(OWNER, sql`select id::text as id from messages where conversation_id = ${CHAT}`)).toEqual([QUESTION, ANSWER].sort())
  })

  it('refuses a personal chat written under someone else’s name, and a colleague’s turn naming the chat’s id inserts nothing', async () => {
    expect(
      await refusal(() =>
        as(COLLEAGUE, () =>
          db.execute(sql`insert into conversations (id, organization_id, created_by) values (${`s_pc_planted_${STAMP}`}, ${ORG}, ${OWNER})`)
        )
      )
    ).toMatch(/row-level security/)
    const { insertConversation } = await import('./repository')
    const inserted = await as(COLLEAGUE, () =>
      insertConversation({ id: CHAT, organizationId: ORG, createdBy: COLLEAGUE, title: 'Mein Chat', projectId: null })
    )
    expect(inserted).toBeNull()
    expect(await platformIds(sql`select id from conversations where id = ${CHAT} and created_by = ${OWNER}`)).toEqual([CHAT])
  })

  it('treats a colleague’s request naming the chat as a refusal, never as a new chat', async () => {
    const { readConversationRow } = await import('@/lib/conversation-context/audience')
    const { authorizeConversationScope } = await import('@/lib/retrieval-scope/collection-scope-request')
    await expect(as(COLLEAGUE, () => readConversationRow(ORG, CHAT))).rejects.toMatchObject({ status: 404 })
    await expect(as(COLLEAGUE, () => authorizeConversationScope(sessionOf(COLLEAGUE), CHAT))).rejects.toMatchObject({ status: 404 })
    const fresh = await as(COLLEAGUE, () => readConversationRow(ORG, `s_pc_new_${STAMP}`))
    expect(fresh.exists).toBe(false)
  })

  it('refuses every egress from a chat the asker may not read, where a hidden row read as „drew on nothing“', async () => {
    const { requireNoPersonalShelfEgress, requireMayLeaveConversation } = await import('./restricted-egress')
    const { drewOnOtherProjects } = await import('./cross-project-use')
    const { personalShelfUseOf } = await import('./personal-shelf-use')
    const origin = { conversationId: CHAT, locale: 'de' as const }
    await expect(as(COLLEAGUE, () => requireNoPersonalShelfEgress(origin, ORG))).rejects.toMatchObject({ code: 'CONVERSATION_CONFINED' })
    await expect(as(null, () => requireMayLeaveConversation(origin, ORG, 'memory'))).rejects.toMatchObject({ code: 'CONVERSATION_CONFINED' })
    expect(await as(COLLEAGUE, () => drewOnOtherProjects(CHAT, ORG))).toBe(true)
    expect(await as(null, () => personalShelfUseOf(ORG, CHAT))).toEqual({ ownerId: null })
    await expect(as(OWNER, () => requireNoPersonalShelfEgress(origin, ORG))).resolves.toBeUndefined()
  })

  it('refuses memory from a temporary personal chat in a context with no person, where it read as „not temporary“', async () => {
    const { requireConversationKeepsMemory } = await import('./temporary')
    await as(OWNER, () =>
      db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, temporary, started_in_personal)
        values (${TEMPORARY_CHAT}, ${ORG}, ${OWNER}, 'Nur kurz', true, true)`)
    )
    await expect(as(COLLEAGUE, () => requireConversationKeepsMemory(TEMPORARY_CHAT, ORG))).rejects.toMatchObject({ status: 404 })
    await expect(asReader('conversation-memory', () => requireConversationKeepsMemory(TEMPORARY_CHAT, ORG))).rejects.toMatchObject({
      code: 'TEMPORARY_CONVERSATION',
    })
    const { POST } = await import('@/app/api/internal/memory/route')
    const response = await POST(
      internalRequest('/api/internal/memory', {
        scope: 'project',
        projectId,
        organizationId: ORG,
        kind: 'derived_fact',
        content: 'Die Bauklasse ist II.',
        sourceConversationId: TEMPORARY_CHAT,
      })
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TEMPORARY_CONVERSATION' })
    expect(await platformIds(sql`select id::text as id from project_memory where source_conversation_id = ${TEMPORARY_CHAT}`)).toEqual([])
  })

  it('lets the named system readers act for the chat: the agent host writes the answer, the document notices read it', async () => {
    const { persistInternalConversationMessages } = await import('./service')
    const written = await asReader('agent-host', () =>
      persistInternalConversationMessages(ORG, CHAT, [{ id: randomUUID(), role: 'assistant', content: 'Nachtrag.' }])
    )
    expect(written).toHaveLength(1)
    expect(await ids(OWNER, sql`select id::text as id from messages where content = 'Nachtrag.'`)).toEqual([written[0]!.id])
    for (const reader of ['agent-host', 'conversation-memory', 'document-notices'] as const) {
      expect(await rows((fn) => asReader(reader, fn), sql`select id from conversations where id = ${CHAT}`), reader).toEqual([CHAT])
    }
  })

  it('leaves the platform scope as it was: it reads every chat', async () => {
    expect(await platformIds(sql`select id from conversations where id in (${CHAT}, ${PROJECT_CHAT})`)).toEqual([CHAT, PROJECT_CHAT].sort())
  })

  it('keeps a chat in a project on the organization’s policy', async () => {
    for (const reader of [COLLEAGUE, null]) {
      expect(await ids(reader, sql`select id from conversations where id = ${PROJECT_CHAT}`)).toEqual([PROJECT_CHAT])
      expect(await ids(reader, sql`select id::text as id from messages where conversation_id = ${PROJECT_CHAT}`)).toEqual([PROJECT_MESSAGE])
    }
  })

  it('opens the chat to a grantee, written only by someone who may read it, and closes it when the grant goes', async () => {
    const grant = (userId: string, subject: string) =>
      as(userId, () =>
        db.execute(sql`
          insert into resource_shares (organization_id, resource_type, resource_id, subject_user_id, role, granted_by)
          values (${ORG}, 'conversation', ${CHAT}, ${subject}, 'collaborator', ${userId})`)
      )
    expect(await refusal(() => grant(COLLEAGUE, COLLEAGUE))).toMatch(/only someone who may read a personal chat grants it/)
    expect(await ids(COLLEAGUE, sql`select id from conversations where id = ${CHAT}`)).toEqual([])

    const before = await audienceVersion()
    await grant(OWNER, GRANTEE)
    expect(await audienceVersion()).toBe(before + 1)
    expect(await ids(GRANTEE, sql`select id from conversations where id = ${CHAT}`)).toEqual([CHAT])
    expect(await ids(GRANTEE, sql`select message_id as id from answer_contexts where conversation_id = ${CHAT}`)).toEqual([ANSWER])
    await as(GRANTEE, () =>
      db.execute(sql`insert into messages (conversation_id, organization_id, role, author_user_id, content) values (${CHAT}, ${ORG}, 'user', ${GRANTEE}, 'Danke!')`)
    )
    expect(await ids(OWNER, sql`select author_user_id as id from messages where content = 'Danke!'`)).toEqual([GRANTEE])

    await as(GRANTEE, () =>
      db.execute(sql`delete from resource_shares where resource_id = ${CHAT} and subject_user_id = ${GRANTEE}`)
    )
    expect(await audienceVersion()).toBe(before + 2)
    expect(await ids(GRANTEE, sql`select id from conversations where id = ${CHAT}`)).toEqual([])
    expect(await ids(GRANTEE, sql`select id::text as id from messages where conversation_id = ${CHAT}`)).toEqual([])
  })

  it('marks a revision thread’s messages whoever changed the thing it is about, as the marks are the chat’s', async () => {
    await context.withPlatformAccess('spec: forget the marks', () =>
      db.execute(sql`delete from message_restricted_use where conversation_id = ${CHAT}`)
    )
    await as(COLLEAGUE, () => db.execute(sql`select mark_revision_thread(${ORG}, ${CHAT})`))
    expect(await ids(OWNER, sql`select message_id as id from message_restricted_use where conversation_id = ${CHAT}`)).toEqual(
      expect.arrayContaining([QUESTION, ANSWER])
    )
  })

  it('erases a chat marked for deletion through the purger’s route, where a context with no person found it „already gone“', async () => {
    await as(OWNER, () =>
      db.execute(sql`
        insert into conversations (id, organization_id, created_by, title, started_in_personal)
        values (${ERASED_CHAT}, ${ORG}, ${OWNER}, 'Wegwerfen', true)`)
    )
    const { markConversationDeleting } = await import('./repository')
    await as(OWNER, () => markConversationDeleting(ERASED_CHAT, ORG, OWNER))
    const { POST } = await import('@/app/api/internal/conversations/[id]/erase/route')
    const response = await POST(internalRequest(`/api/internal/conversations/${ERASED_CHAT}/erase`, { organizationId: ORG }), {
      params: Promise.resolve({ id: ERASED_CHAT }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: 'erased' })
    expect(await platformIds(sql`select id from conversations where id = ${ERASED_CHAT}`)).toEqual([])
    expect(
      await platformIds(sql`select status as id from deletion_queue where entity_type = 'conversation' and entity_id = ${ERASED_CHAT}`)
    ).toEqual(['purged'])
  })
})

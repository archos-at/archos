/**
 * @vitest-environment node
 *
 * Sender memory against a REAL Postgres with migration 0253, through the
 * restricted runtime role (`scripts/rls-test-db.sh`):
 *
 *   bash scripts/rls-test-db.sh --only bff/inbound-mail/sender-memory.integration.spec.ts
 *
 * `findSenderFolders` names the folders where this project's attachments from
 * earlier mails of one sender address went, newest first, each with its count,
 * and only what the reader may see: a hidden folder, a binned folder, a held or
 * archived document, another project's or another sender's filings, an archive
 * import's and the mail's own never count. And the read is the index's.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now().toString(36)
const ORG = `org_sender_memory_${STAMP}`
const USER = 'user_01J0SENDERMEMORYSPEC00000A'
const SENDER = 'p.weber@fassade-weber.at'
const DAY_MS = 86_400_000

describe('the suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('where a sender’s earlier attachments went (sender memory, migration 0253)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let memory: typeof import('./sender-memory-repository')
  let SCREENED_ONLY: typeof import('@/lib/documents/visibility').SCREENED_ONLY
  let projectId: string
  let otherProjectId: string
  const folders: Record<string, string> = {}
  const CURRENT_MAIL = crypto.randomUUID()

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run)
  async function rows<T>(statement: ReturnType<typeof sql>): Promise<T[]> {
    return Array.from(await inTenant(() => db.execute(statement))) as T[]
  }
  const one = async <T>(statement: ReturnType<typeof sql>): Promise<T> => (await rows<T>(statement))[0] as T

  async function project(name: string): Promise<string> {
    return (
      await one<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, ${name}, ${USER}, ${`coll_sender_${STAMP}_${name.length}`}) RETURNING id`)
    ).id
  }

  async function folder(project: string, path: string): Promise<string> {
    return (
      await one<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, project_id, name, path)
        VALUES (${ORG}, ${project}::uuid, ${path.split('/').at(-1)}, ${path}) RETURNING id`)
    ).id
  }

  let entries = 0

  /** One filed mail: its entry in a Verlauf of its own, and one attachment row per file, each a document in `folderId`. */
  async function filedMail(input: {
    project?: string
    sender?: string
    daysAgo: number
    files: Array<{ folderId: string; status?: string; lifecycle?: string }>
    source?: 'inbound' | 'archive'
    inboundMailId?: string
  }): Promise<void> {
    const project = input.project ?? projectId
    entries += 1
    const threadId = (
      await one<{ id: string }>(sql`
        INSERT INTO mail_threads (organization_id, project_id, base_subject, locale, created_by)
        VALUES (${ORG}, ${project}::uuid, 'fassade', 'de', ${USER}) RETURNING id`)
    ).id
    const archive = input.source === 'archive'
    const receivedAt = new Date(Date.now() - input.daysAgo * DAY_MS)
    const entryId = (
      await one<{ id: string }>(sql`
        INSERT INTO mail_thread_entries
          (organization_id, project_id, thread_id, source, inbound_mail_id, mail_import_id, sent_at, received_at, heading,
           sender_address, sender_name, sender_trust, filed_by, filed_via)
        VALUES (${ORG}, ${project}::uuid, ${threadId}::uuid, ${archive ? 'archive' : 'inbound'},
                ${archive ? null : (input.inboundMailId ?? crypto.randomUUID())}::uuid, ${archive ? crypto.randomUUID() : null}::uuid,
                ${receivedAt.toISOString()}::timestamptz, ${receivedAt.toISOString()}::timestamptz, ${`Nachricht ${entries}`},
                ${input.sender ?? SENDER}, 'DI Petra Weber', ${archive ? 'not_checked' : 'external_unverified'}, ${USER},
                ${archive ? 'archive_import' : 'app'})
        RETURNING id`)
    ).id
    for (const [position, file] of input.files.entries()) {
      const documentId = (
        await one<{ id: string }>(sql`
          INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id, lifecycle)
          VALUES (${ORG}, ${USER}, ${`Plan ${entries}-${position}.pdf`}, ${`k/${STAMP}/${entries}/${position}`}, 'coll_sender',
                  ${file.status ?? 'completed'}, 'project', ${project}::uuid, ${file.folderId}::uuid, ${file.lifecycle ?? 'active'})
          RETURNING id`)
      ).id
      await rows(sql`
        INSERT INTO mail_thread_entry_attachments (organization_id, project_id, entry_id, position, filename, disposition, document_id)
        VALUES (${ORG}, ${project}::uuid, ${entryId}::uuid, ${position}, ${`Plan ${entries}-${position}.pdf`}, 'filed', ${documentId}::uuid)`)
    }
  }

  const query = (overrides: Partial<import('./sender-memory-repository').SenderFoldersQuery> = {}) => ({
    organizationId: ORG,
    projectId,
    senderAddress: SENDER,
    exceptMailId: CURRENT_MAIL,
    reader: SCREENED_ONLY,
    hiddenFolderIds: [] as string[],
    ...overrides,
  })
  const find = (overrides: Partial<import('./sender-memory-repository').SenderFoldersQuery> = {}) =>
    inTenant(() => memory.findSenderFolders(query(overrides)))

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    memory = await import('./sender-memory-repository')
    SCREENED_ONLY = (await import('@/lib/documents/visibility')).SCREENED_ONLY

    projectId = await project('Fassadenweg 3')
    otherProjectId = await project('Anderes Projekt 12')
    for (const path of ['Planung/Fassade', 'Tragwerk', 'Planung', 'Vertraulich', 'Alt', 'Ablage'])
      folders[path] = await folder(projectId, path)
    folders.other = await folder(otherProjectId, 'Planung/Fassade')

    await filedMail({ daysAgo: 21, files: [{ folderId: folders['Planung/Fassade']! }, { folderId: folders['Planung/Fassade']! }] })
    await filedMail({ daysAgo: 14, files: [{ folderId: folders.Tragwerk! }] })
    await filedMail({ daysAgo: 7, files: [{ folderId: folders['Planung/Fassade']! }] })
    await filedMail({ daysAgo: 30, files: [{ folderId: folders.Planung! }] })
    await filedMail({ daysAgo: 3, files: [{ folderId: folders.Vertraulich! }] })
    await filedMail({ daysAgo: 2, files: [{ folderId: folders.Alt! }] })
    await rows(sql`UPDATE project_folders SET deleted_at = now(), deleted_by = ${USER} WHERE id = ${folders.Alt}::uuid`)
    await filedMail({ daysAgo: 1, files: [{ folderId: folders.Ablage!, status: 'quarantined' }, { folderId: folders.Ablage!, lifecycle: 'archived' }] })
    await filedMail({ daysAgo: 1, sender: 'office@fassade-weber.at', files: [{ folderId: folders.Ablage! }] })
    await filedMail({ daysAgo: 1, source: 'archive', files: [{ folderId: folders.Ablage! }] })
    await filedMail({ daysAgo: 0, inboundMailId: CURRENT_MAIL, files: [{ folderId: folders.Ablage! }] })
    await filedMail({ project: otherProjectId, daysAgo: 0, files: [{ folderId: folders.other! }] })
  })

  afterAll(async () => {
    await withPlatformAccess('test cleanup', () => db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`))
  })

  it('names the folders this sender’s attachments went to, newest first, each counted per attachment', async () => {
    expect(await find({ hiddenFolderIds: [folders.Vertraulich!] })).toEqual([
      { folderId: folders['Planung/Fassade'], path: 'Planung/Fassade', count: 3 },
      { folderId: folders.Tragwerk, path: 'Tragwerk', count: 1 },
      { folderId: folders.Planung, path: 'Planung', count: 1 },
    ])
  })

  it('matches the address whatever its case', async () => {
    expect((await find({ senderAddress: 'P.Weber@Fassade-Weber.AT', hiddenFolderIds: [folders.Vertraulich!] })).map((row) => row.path)).toEqual([
      'Planung/Fassade',
      'Tragwerk',
      'Planung',
    ])
  })

  it('never names a folder the reader may not see, and names at most four', async () => {
    const visible = await find()
    expect(visible.map((row) => row.path)).toEqual(['Vertraulich', 'Planung/Fassade', 'Tragwerk', 'Planung'])
    expect(visible.map((row) => row.folderId)).not.toContain(folders.Alt)
    expect((await find({ hiddenFolderIds: [folders.Vertraulich!] })).map((row) => row.folderId)).not.toContain(folders.Vertraulich)
  })

  it('never counts a held or archived document, another sender’s, an archive import’s, or the mail’s own', async () => {
    expect((await find()).map((row) => row.folderId)).not.toContain(folders.Ablage)
    expect(await find({ senderAddress: 'office@fassade-weber.at' })).toEqual([{ folderId: folders.Ablage, path: 'Ablage', count: 1 }])
    expect(await find({ exceptMailId: crypto.randomUUID(), hiddenFolderIds: [folders.Vertraulich!] })).toEqual([
      { folderId: folders.Ablage, path: 'Ablage', count: 1 },
      { folderId: folders['Planung/Fassade'], path: 'Planung/Fassade', count: 3 },
      { folderId: folders.Tragwerk, path: 'Tragwerk', count: 1 },
      { folderId: folders.Planung, path: 'Planung', count: 1 },
    ])
  })

  it('never names another project’s folder, nor anything of another organization', async () => {
    expect(await find({ projectId: otherProjectId })).toEqual([{ folderId: folders.other, path: 'Planung/Fassade', count: 1 }])
    expect(await find({ organizationId: `${ORG}_other` })).toEqual([])
    expect(await withTenant({ organizationId: `${ORG}_other`, userId: USER }, () => memory.findSenderFolders(query()))).toEqual([])
  })

  it('reads the sender’s entries through the 0253 index', async () => {
    const plan = await inTenant(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL enable_seqscan = off`)
        return Array.from(await tx.execute(sql`EXPLAIN ${memory.senderFoldersQuery(query())}`)) as Array<{ 'QUERY PLAN': string }>
      }),
    )
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('mail_thread_entries_sender_idx')
  })
})

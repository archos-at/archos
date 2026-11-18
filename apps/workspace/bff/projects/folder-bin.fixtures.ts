import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import type { AuthorizedSession } from '@/lib/auth/types'
import { restrictedCollectionName } from '@/lib/authz/folder-access-rule'
import { REVIEWER_READER } from '@/lib/documents/document-reader'

export const url = process.env.TEST_DATABASE_URL
export const STAMP = `${Date.now()}_${process.pid}`
export const ORG = `org_bin_${STAMP}`
export const USER = `user_bin_${STAMP}`
export const COLLECTION = `proj_bin_${STAMP}`
export const CHAT = `s_bin_chat_${STAMP}`
export const GF = 'om_gf'
export const BH = 'om_bh'
export const PL = 'om_pl'
export const PROJECT_WRITE = ['project:view', 'project:documents:write', 'project:edit']

export const sessionOf = (userId: string, membershipId: string | null, permissions: string[]): AuthorizedSession =>
  ({
    userId,
    organizationId: ORG,
    organizationMembershipId: membershipId,
    email: `${userId}@example.test`,
    role: 'member',
    roles: ['member'],
    permissions,
  }) as unknown as AuthorizedSession

export const gf = sessionOf('user_gf', GF, PROJECT_WRITE)
export const bh = sessionOf('user_bh', BH, PROJECT_WRITE)
export const pl = sessionOf('user_pl', PL, PROJECT_WRITE)
export const manager = sessionOf('user_mgr', GF, [...PROJECT_WRITE, 'project:manage'])
export const admin = sessionOf('user_admin', null, ['org:projects:administer'])

class Rollback extends Error {}

export const lists = new Map<string, Record<string, 'read' | 'write'>>()
export const levelsOf = (membershipId: string | null) =>
  Object.fromEntries(
    [...lists].flatMap(([folderId, list]) => (membershipId && list[membershipId] ? [[folderId, list[membershipId]]] : []))
  ) as Record<string, 'read' | 'write'>

export let db: ReturnType<typeof import('@/lib/db').getDb>
export let withTenant: typeof import('@/lib/db/tenant-context').withTenant
export let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
export let bin: typeof import('./folder-bin')
export let access: typeof import('@/lib/authz/folder-access')
export let docsRepo: typeof import('@/lib/documents/repository')
export let folders: typeof import('./folder-service')
export let restrictedUse: typeof import('@/lib/conversations/restricted-use')
export let setting: typeof import('@/lib/organizations/deleted-folder-content-service')
export let collectionRef: typeof import('@/lib/documents/collection-file-ref')
export let documentService: typeof import('@/lib/documents/document-dispatch')
export let lifecycle: typeof import('@/lib/documents/lifecycle')
export let jobs: typeof import('./folder-bin-jobs')
export let projectId: string
export const folder: Record<string, string> = {}
export const doc: Record<string, string> = {}
export const message: Record<string, string> = {}
export const memory: Record<string, string> = {}

export const inOrg = <T>(run: () => PromiseLike<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run) as Promise<T>
export function inTenant<M extends object>(module: M): M {
  return new Proxy(module, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => inOrg(async () => (value as (...input: unknown[]) => unknown)(...args))
    },
  })
}
export const ids = (rows: Iterable<{ id: string }>): string[] => Array.from(rows).map((row) => String(row.id))

export async function insertFolder(name: string, parentId: string | null, path: string, list: Array<[string, 'read' | 'write']> | null): Promise<string> {
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, project_id, parent_id, name, path, access_mode, access_changed_by, access_changed_at)
        VALUES (${ORG}, ${projectId}::uuid, ${parentId}::uuid, ${name}, ${path}, ${list ? 'custom' : 'inherit'},
                ${list ? USER : null}, ${list ? new Date().toISOString() : null}::timestamptz)
        RETURNING id
      `)
    )
  )
  if (list) lists.set(id, Object.fromEntries(list))
  return id
}

export async function insertDocument(filename: string, folderId: string | null, collection = COLLECTION, createdBy = USER): Promise<string> {
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id)
        VALUES (${ORG}, ${createdBy}, ${filename}, ${`k/${filename}`}, ${collection}, 'completed', 'project', ${projectId}::uuid, ${folderId}::uuid)
        RETURNING id
      `)
    )
  )
  return id
}

export async function insertAnswer(content: string, sources: Array<Record<string, string>>): Promise<string> {
  const metadata = JSON.stringify({ citations: { v: 1, sources }, provenance: { answerConfidence: 'high' } })
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO messages (conversation_id, organization_id, role, content, metadata)
        VALUES (${CHAT}, ${ORG}, 'assistant', ${content}, ${metadata}::jsonb)
        RETURNING id
      `)
    )
  )
  return id
}

export async function insertNote(content: string, restricted: string[] | null, sourceConversation: string | null): Promise<string> {
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO project_memory (scope, project_id, organization_id, kind, content, restricted_folder_ids, source_conversation_id)
        VALUES ('project', ${projectId}::uuid, ${ORG}, 'decision', ${content},
                ${restricted ? `{${restricted.join(',')}}` : null}::uuid[], ${sourceConversation})
        RETURNING id
      `)
    )
  )
  return id
}

export async function folderState(folderId: string) {
  const [row] = await inOrg(() =>
    db.execute<{ deleted_at: string | null; purged_at: string | null; bin_root_id: string | null; parent_id: string | null; path: string }>(
      sql`SELECT deleted_at, purged_at, bin_root_id, parent_id, path FROM project_folders WHERE id = ${folderId}::uuid`
    )
  )
  return row
}

export async function queueRow(folderId: string) {
  const rows = await withPlatformAccess('test: read the folder queue', () =>
    db.execute<{ status: string; payload: Record<string, unknown>; requested_by: string; purge_after: string }>(sql`
      SELECT status, payload, requested_by, purge_after FROM deletion_queue
      WHERE entity_type = 'folder' AND entity_id = ${folderId} ORDER BY requested_at DESC`)
  )
  return Array.from(rows)
}

export async function visibleDocumentNames(session: AuthorizedSession): Promise<string[]> {
  const hidden = await access.getHiddenFolderIds(session, projectId)
  const rows = await inOrg(() => docsRepo.listProjectDocuments(projectId, ORG, { hiddenFolderIds: hidden, reader: REVIEWER_READER }))
  return rows.map((row) => row.filename).sort()
}

export async function hold(entityType: string, entityId: string): Promise<void> {
  await inOrg(() =>
    db.execute(sql`
      INSERT INTO legal_holds (entity_type, entity_id, organization_id, reason, created_by)
      VALUES (${entityType}, ${entityId}, ${ORG}, 'integration test', ${USER})`)
  )
}

export async function releaseHolds(): Promise<void> {
  await inOrg(() => db.execute(sql`UPDATE legal_holds SET released_at = now() WHERE organization_id = ${ORG} AND released_at IS NULL`))
}

export async function claimable(): Promise<string[]> {
  const { claimNext } = await import('../../purger/db.js')
  const client = postgres(url as string, { prepare: false, max: 1 })
  const claimed: string[] = []
  try {
    await client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform')
      for (let i = 0; i < 1000; i += 1) {
        const entry = await claimNext(tx as never)
        if (!entry) break
        claimed.push(entry.entity_id)
      }
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  } finally {
    await client.end()
  }
  return claimed
}

export async function queuedJobs(kind: string) {
  const rows = await withPlatformAccess('test: read the job queue', () =>
    db.execute<{ job_id: string; priority: number; payload: Record<string, unknown>; not_before: string | null }>(sql`
      SELECT job_id, priority, payload, not_before FROM bff_job_queue
      WHERE lane = ${ORG} AND kind = ${kind} ORDER BY created_at`)
  )
  return Array.from(rows)
}

export async function documentRow(documentId: string) {
  const [row] = await inOrg(() =>
    db.execute<{ status: string; metadata: Record<string, unknown> | null; error_message: string | null; collection_name: string }>(
      sql`SELECT status, metadata, error_message, collection_name FROM documents WHERE id = ${documentId}::uuid`
    )
  )
  return row
}

export async function runRestoreJob(session: AuthorizedSession, payload: Record<string, unknown>) {
  let state = payload as Parameters<typeof jobs.runRestoreFolderSlice>[1]
  for (let slice = 0; slice < 100; slice += 1) {
    const result = await jobs.runRestoreFolderSlice(session, state)
    state = result.payload
    if (result.done) return state
  }
  throw new Error('the restore job never finished')
}

export async function makeDue(folderId: string): Promise<void> {
  await withPlatformAccess('test: make the bin entry due', () =>
    db.execute(sql`UPDATE deletion_queue SET purge_after = now() - interval '1 minute'
                   WHERE entity_type = 'folder' AND entity_id = ${folderId} AND status = 'pending'`)
  )
}

export async function seed(): Promise<void> {
  folder.admin = await insertFolder('Verwaltung', null, 'Verwaltung', null)
  folder.contracts = await insertFolder('Verträge', folder.admin, 'Verwaltung/Verträge', [
    [GF, 'write'],
    [BH, 'read'],
  ])
  folder.old = await insertFolder('Alt', folder.contracts, 'Verwaltung/Verträge/Alt', null)
  folder.plans = await insertFolder('Pläne', null, 'Pläne', null)
  folder.officeShelf = await insertFolder('Archiv', folder.plans, 'Pläne/Archiv', null)
  const restricted = restrictedCollectionName(COLLECTION, folder.contracts)
  doc.sitePlan = await insertDocument('Lageplan.pdf', null)
  doc.protokoll = await insertDocument('Protokoll.pdf', folder.admin)
  doc.contract = await insertDocument('Vertrag.pdf', folder.contracts, restricted, 'user_custodian')
  doc.old = await insertDocument('Alt.pdf', folder.old, restricted)
  doc.plan = await insertDocument('Plan.pdf', folder.plans)
  doc.officeShelf = await insertDocument('Archiv.pdf', folder.officeShelf)
}

export async function wipe(): Promise<void> {
  await releaseHolds()
  await withPlatformAccess('test: clean up', async () => {
    await db.execute(sql`DELETE FROM deletion_queue WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM bff_job_queue WHERE lane = ${ORG}`)
    await db.execute(sql`DELETE FROM project_memory WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM messages WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM conversation_restricted_folders WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM resource_shares WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM conversations WHERE organization_id = ${ORG} AND id <> ${CHAT}`)
    await db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM project_folders WHERE project_id = ${projectId}::uuid`)
    await db.execute(sql`DELETE FROM legal_holds WHERE organization_id = ${ORG}`)
  })
}

export async function openBinFixtures(): Promise<void> {
  process.env.APP_DATABASE_URL = url
  const context = await import('@/lib/db/tenant-context')
  withTenant = context.withTenant
  withPlatformAccess = context.withPlatformAccess
  db = (await import('@/lib/db')).getDb()
  bin = inTenant(await import('./folder-bin'))
  access = inTenant(await import('@/lib/authz/folder-access'))
  docsRepo = inTenant(await import('@/lib/documents/repository'))
  folders = inTenant(await import('./folder-service'))
  restrictedUse = inTenant(await import('@/lib/conversations/restricted-use'))
  setting = inTenant(await import('@/lib/organizations/deleted-folder-content-service'))
  collectionRef = await import('@/lib/documents/collection-file-ref')
  documentService = await import('@/lib/documents/document-dispatch')
  lifecycle = await import('@/lib/documents/lifecycle')
  jobs = inTenant(await import('./folder-bin-jobs'))

  await withPlatformAccess('test seed: organization', () =>
    db.execute(sql`INSERT INTO organizations (workos_organization_id, display_name) VALUES (${ORG}, ${ORG}) ON CONFLICT DO NOTHING`)
  )
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, 'Papierkorb', ${USER}, ${COLLECTION}) RETURNING id`)
    )
  )
  projectId = id
  await inOrg(() =>
    db.execute(sql`INSERT INTO conversations (id, organization_id, created_by, project_id, title)
                   VALUES (${CHAT}, ${ORG}, ${USER}, ${projectId}::uuid, 'Pläne')`)
  )
}

export async function closeBinFixtures(): Promise<void> {
  await wipe()
  await withPlatformAccess('test: clean up project', async () => {
    await db.execute(sql`DELETE FROM conversations WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM organizations WHERE workos_organization_id = ${ORG}`)
  })
  const { closeDb } = await import('@/lib/db')
  await closeDb()
}

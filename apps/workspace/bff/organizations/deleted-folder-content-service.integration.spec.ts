/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { restrictedCollectionName } from '@/lib/authz/folder-access-rule'
import {
  BH,
  CHAT,
  COLLECTION,
  GF,
  ORG,
  PL,
  PROJECT_WRITE,
  STAMP,
  access,
  admin,
  bh,
  bin,
  closeBinFixtures,
  collectionRef,
  db,
  documentService,
  folder,
  gf,
  ids,
  inOrg,
  inTenant,
  insertAnswer,
  insertNote,
  levelsOf,
  lifecycle,
  openBinFixtures,
  pl,
  projectId,
  restrictedUse,
  seed,
  sessionOf,
  setting,
  url,
  wipe,
} from '@/lib/projects/folder-bin.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn(async () => new Map()) }))
vi.mock('@/lib/documents/collection-file-ref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/collection-file-ref')>()),
  purgeIngestedChunks: vi.fn(async () => true),
}))
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))
vi.mock('@/lib/documents/document-edits', () => ({
  eraseProjectDocument: vi.fn(async (doc: { id: string; organizationId: string; projectId: string }) => {
    const { deleteProjectDocument } = await import('@/lib/documents/repository')
    await deleteProjectDocument(doc.id, doc.organizationId, doc.projectId)
    return true
  }),
}))
const projectState = vi.hoisted(() => ({ closed: false }))
vi.mock('@/lib/authz/projects', async () => {
  const { NotFoundError } = await import('@/lib/api/errors')
  const { keptWhenClosed, projectClosedError } = await import('@/lib/projects/project-status')
  return {
    requireProjectAccess: vi.fn(
      async (
        session: { permissions: string[] },
        _projectId: string,
        needed: string | readonly string[],
        options: { evenWhenClosed?: boolean } = {}
      ) => {
        const asked = (Array.isArray(needed) ? needed : [needed]) as Parameters<typeof keptWhenClosed>[0]
        const readOnly = projectState.closed && !options.evenWhenClosed
        const wanted = readOnly ? keptWhenClosed(asked) : asked
        if (wanted.length === 0) throw projectClosedError()
        const closed = projectState.closed
        if (session.permissions.includes('org:projects:administer')) return { role: 'project-admin', closed, readsBecauseClosed: false }
        if (!wanted.some((permission) => session.permissions.includes(permission))) throw new NotFoundError()
        return { role: session.permissions.includes('project:manage') ? 'project-admin' : 'project-editor', closed, readsBecauseClosed: false }
      }
    ),
  }
})
vi.mock('@/lib/auth/membership-roles', () => ({ resolveMembershipRoles: vi.fn(async () => null) }))
vi.mock('@/lib/authz/folder-roles', async () => {
  const { levelsOf } = await import('@/lib/projects/folder-bin.fixtures')
  return { heldFolderLevels: vi.fn(async (_org: string, membershipId: string) => levelsOf(membershipId)) }
})
vi.mock('@/lib/documents/lifecycle', () => ({
  redispatchPublishedVersion: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))

describe.skipIf(!url)('the Papierkorb against live Postgres (migration 0115)', () => {
  beforeAll(openBinFixtures)

  beforeEach(async () => {
    await wipe()
    await seed()
    await setting.saveDeletedFolderContentPolicy(admin, 'unchanged', new Request('http://test'))
    vi.mocked(collectionRef.purgeIngestedChunks).mockReset()
    vi.mocked(collectionRef.purgeIngestedChunks).mockResolvedValue(true)
    vi.mocked(documentService.dispatchDocument).mockClear()
    vi.mocked(lifecycle.redispatchPublishedVersion).mockClear()
  })

  afterAll(closeBinFixtures)

  describe('a chat that drew on a purged folder: the setting and the read-time conversation lock are one rule', () => {
    async function chatOnVertraege(): Promise<string> {
      const id = `s_bin_lock_${STAMP}_${Math.random().toString(36).slice(2, 8)}`
      await inOrg(() =>
        db.execute(sql`INSERT INTO conversations (id, organization_id, created_by, project_id, title, visibility)
                       VALUES (${id}, ${ORG}, 'user_gf', ${projectId}::uuid, 'Honorar', 'private')`)
      )
      const { upsertGrant } = await import('@/lib/sharing/repository')
      for (const subject of ['user_bh', 'user_pl', 'user_admin']) {
        await inOrg(() =>
          upsertGrant({
            organizationId: ORG,
            resourceType: 'conversation',
            resourceId: id,
            subjectUserId: subject,
            role: 'viewer',
            grantedBy: 'user_gf',
          })
        )
      }
      const metadata = JSON.stringify({
        citations: { v: 1, sources: [{ collection: restrictedCollectionName(COLLECTION, folder.contracts), file_name: 'Vertrag.pdf' }] },
      })
      await inOrg(() =>
        db.execute(sql`INSERT INTO messages (conversation_id, organization_id, role, content, metadata)
                       VALUES (${id}, ${ORG}, 'assistant', 'Laut Vertrag …', ${metadata}::jsonb)`)
      )
      return id
    }

    it.each([
      ['unchanged', { gf: false, bh: false, pl: true, admin: false }],
      ['project', { gf: false, bh: false, pl: false, admin: false }],
      ['admins', { gf: true, bh: true, pl: true, admin: false }],
      ['remove', { gf: true, bh: true, pl: true, admin: false }],
    ] as const)('%s: locked for exactly the people the folder rule leaves out', async (policy, expected) => {
      const sharing = inTenant(await import('@/lib/sharing/access'))
      const id = await chatOnVertraege()
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      await bin.purgeBinnedFolder(ORG, folder.contracts)
      expect(ids(await inOrg(() => db.execute<{ id: string }>(sql`
        SELECT folder_id AS id FROM conversation_restricted_folders WHERE conversation_id = ${id}`)))).toEqual([folder.contracts])
      await setting.saveDeletedFolderContentPolicy(admin, policy, new Request('http://test'))

      const people = { gf: sessionOf('user_gf', GF, PROJECT_WRITE), bh, pl, admin }
      const locked: Record<string, boolean> = {}
      for (const [name, session] of Object.entries(people)) {
        const answer = await sharing.resolveResourceAccess(session, 'conversation', id)
        expect(answer.role, name).not.toBeNull()
        locked[name] = answer.contentLocked
      }
      expect(locked).toEqual(expected)
      const refused = (Object.keys(expected) as Array<keyof typeof expected>).find((name) => expected[name])
      if (refused) {
        await expect(sharing.requireResourceAccess(people[refused], 'conversation', id, 'viewer')).rejects.toMatchObject({
          code: 'RESOURCE_RIGHTS_LOST',
        })
      }
      await expect(sharing.requireResourceAccess(admin, 'conversation', id, 'viewer')).resolves.toBeDefined()
    })
  })

  describe('„Inhalte aus gelöschten Ordnern": applied when derived content is read', () => {
    async function purgeVertraege(): Promise<void> {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      await bin.purgeBinnedFolder(ORG, folder.contracts)
    }
    const reads = async (membershipId: string | null, seesEverything = false) =>
      (await access.readableFolderIdsFor(ORG, projectId, { levels: levelsOf(membershipId), seesEverything })).includes(
        folder.contracts
      )

    it.each([
      ['unchanged', { gf: true, bh: true, pl: false, admin: true }],
      ['project', { gf: true, bh: true, pl: true, admin: true }],
      ['admins', { gf: false, bh: false, pl: false, admin: true }],
      ['remove', { gf: false, bh: false, pl: false, admin: true }],
    ] as const)('%s', async (policy, expected) => {
      await purgeVertraege()
      await setting.saveDeletedFolderContentPolicy(admin, policy, new Request('http://test'))
      expect({ gf: await reads(GF), bh: await reads(BH), pl: await reads(PL), admin: await reads(null, true) }).toEqual(expected)
    })

    it('decides a memory note and a conversation by the same rule', async () => {
      const note = await insertNote('Honorar 12 %', [folder.contracts], null)
      const cites = await insertAnswer('Vertrag sagt …', [{ collection: restrictedCollectionName(COLLECTION, folder.contracts), file_name: 'Vertrag.pdf' }])
      await purgeVertraege()
      const memory = inTenant(await import('@/lib/projects/memory-service'))
      const visibleTo = async (membershipId: string) =>
        (
          await memory.listProjectMemory(projectId, {
            organizationId: ORG,
            readableFolderIds: await access.readableFolderIdsFor(ORG, projectId, {
              levels: levelsOf(membershipId),
              seesEverything: false,
            }),
          })
        ).map((item) => item.id)
      expect(await visibleTo(BH)).toContain(note)
      expect(await restrictedUse.recordedRestrictedFolders(CHAT, ORG)).toEqual([folder.contracts])
      await setting.saveDeletedFolderContentPolicy(admin, 'project', new Request('http://test'))
      expect(await visibleTo(PL)).toContain(note)
      expect(await restrictedUse.recordedRestrictedFolders(CHAT, ORG)).toEqual([])
      await setting.saveDeletedFolderContentPolicy(admin, 'admins', new Request('http://test'))
      expect(await visibleTo(BH)).not.toContain(note)
      expect(cites).not.toBe('')
    })

    it('restricts the conversations that drew on a purged OPEN folder once the setting says admins only', async () => {
      await insertAnswer('Plan …', [{ collection: COLLECTION, file_name: 'Plan.pdf' }])
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.purgeBinnedFolder(ORG, folder.plans)
      expect(await restrictedUse.recordedRestrictedFolders(CHAT, ORG)).toEqual([])
      await setting.saveDeletedFolderContentPolicy(admin, 'admins', new Request('http://test'))
      expect(await restrictedUse.recordedRestrictedFolders(CHAT, ORG)).toEqual([folder.plans])
    })

    it('„Mit dem Ordner entfernen": the purge removes the derived content with the folder', async () => {
      await setting.saveDeletedFolderContentPolicy(admin, 'remove', new Request('http://test'))
      const cites = await insertAnswer('Plan …', [{ collection: COLLECTION, file_name: 'Plan.pdf' }])
      const note = await insertNote('aus dem Plan', [folder.plans], null)
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const result = await bin.purgeBinnedFolder(ORG, folder.plans)
      expect(result.counts).toMatchObject({ memoryNotes: 1, answers: 1 })
      expect(result.traceConversationIds).toEqual([CHAT])
      const [answer] = await inOrg(() => db.execute<{ content: string }>(sql`SELECT content FROM messages WHERE id = ${cites}::uuid`))
      expect(answer.content).toBe('Inhalt entfernt: Quelle gelöscht')
      const notes = await inOrg(() => db.execute<{ id: string }>(sql`SELECT id FROM project_memory WHERE id = ${note}::uuid`))
      expect(ids(notes)).toEqual([])
    })
  })
})

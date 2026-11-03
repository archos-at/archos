/**
 * @vitest-environment node
 *
 * The dynamic ratchet of review-first (DECISION §10, ratchet 3, its no-follow
 * half), as ADR-0137's amendment of 2026-11-03 left it, against a REAL
 * Postgres with migrations 0194 and 0195 through the restricted runtime role
 * (`scripts/rls-test-db.sh`):
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/inbound-mail/review-first.e2e.spec.ts
 *
 * The owner's sentence is now: a project writer's own signed mail is filed
 * directly, as them; everything else waits for a person, and a mail that
 * claims a writer waits for that writer. The static ratchet
 * (`review-first.spec.ts`) proves the receive side imports no filing code; this
 * one runs it, one mail per class, through the real receive job, the real
 * repository and the real sender's filing and filing jobs:
 *
 * 1. A member WITHOUT write rights, signed for real: it waits (`office_member`),
 *    zero documents, no object outside its own `_inbound-mail/<mail>/`, no job
 *    that files.
 * 2. The filing job, run before anyone decided, files nothing.
 * 3. Once a person decides to file its attachment, exactly that file becomes a
 *    document, uploaded as THAT person; the text becomes nothing.
 * 4. A WRITER's mail, signed for real: `verified_writer`; the sender's filing
 *    decides it as them (`via = 'sender'`) and the filing job uploads it as
 *    them. One more document, nobody pressed anything.
 * 5. The same writer's address whose signature fails, and a spoofed From of the
 *    same writer, unsigned: `unverified_writer`, nothing filed, the sender's
 *    filing refuses it, and the database refuses a direct decision for it.
 * 6. An outsider: `external`, waiting 14 days, nothing filed.
 *
 * Mocked are only what is outside this tier or the database: the object store
 * (in memory, every write recorded), the scanner, the Python reader, DNS (the
 * signature is real), WorkOS (the member directory, the write right, the
 * sessions, the project and folder access), and the upload path's own
 * machinery past the decision (`uploadDocument`, which here records its call
 * and writes the row an upload would, as the session's tenant).
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  writes: [] as string[],
  erased: [] as string[],
  dns: null as unknown,
  /** Whether the member holds `project:documents:write` (WorkOS, mocked). */
  memberWrites: false,
}))

vi.mock('./staging', () => ({
  RAW_MESSAGE_CONTENT_TYPE: 'message/rfc822',
  readStagedObject: vi.fn(async (_bucket: string, key: string) => {
    const bytes = store.objects.get(key)
    if (!bytes) throw new Error(`no object ${key}`)
    return bytes
  }),
  putStagedObject: vi.fn(async (_bucket: string, key: string, body: Uint8Array) => {
    store.writes.push(key)
    store.objects.set(key, body)
  }),
  eraseStagedObjects: vi.fn(async (_bucket: string, keys: readonly string[]) => {
    for (const key of keys) {
      store.erased.push(key)
      store.objects.delete(key)
    }
    return []
  }),
  stagedObjectUrlForBackend: vi.fn(
    async (_bucket: string, key: string) => `http://store.test/${key}`
  ),
}))
vi.mock('@/lib/malware-scan/client', () => ({
  scanForMalware: vi.fn(async () => ({
    status: 'clean',
    engine: {
      version: 'ClamAV 1.5.4',
      signatures: 28157,
      signaturesPublishedAt: new Date('2026-09-28'),
    },
  })),
}))
vi.mock('./read-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./read-client')>()),
  readMail: vi.fn(),
}))
vi.mock('./sender-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sender-auth')>()
  return {
    ...actual,
    authenticateSender: vi.fn(
      (raw: Uint8Array, options: Parameters<typeof actual.authenticateSender>[1]) =>
        actual.authenticateSender(raw, {
          ...options,
          resolver: (store.dns as { resolver: never }).resolver,
        })
    ),
  }
})
vi.mock('@/lib/documents/accepted-types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/accepted-types')>()),
  acceptedTypesForOrganization: vi.fn(async () => ['.pdf', '.docx', '.txt', '.md']),
}))
// The receive job asks the strict form (a failed read is a fault, `receive-faults.ts`); both answer the same here.
vi.mock('@/lib/sharing/directory', () => {
  const loadOrganizationDirectory = vi.fn()
  return { loadOrganizationDirectory, loadOrganizationDirectoryStrict: loadOrganizationDirectory }
})
vi.mock('@/lib/upload-screening/service', async (importOriginal) => {
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    ...(await importOriginal<typeof import('@/lib/upload-screening/service')>()),
    gatePolicy: vi.fn(async () => SUGGESTED_SCREENING_POLICY),
  }
})
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('@/lib/auth/pinned-session', () => ({
  resolvePinnedRequesterSession: vi.fn(async () => null),
  resolvePinnedRequesterSessionStrict: vi.fn(),
}))
vi.mock('@/lib/authz/project-membership', () => {
  const userHoldsProjectPermission = vi.fn(async (_org: unknown, _project: string, _user: string, permission: string) =>
    store.memberWrites && permission === 'project:documents:write')
  return { userHoldsProjectPermission, userHoldsProjectPermissionStrict: userHoldsProjectPermission }
})
vi.mock('./access', () => ({ requireMailReviewer: vi.fn(async () => ({ closed: false })) }))
vi.mock('@/lib/authz/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz/feature-flags')>()),
  isInboundMailEnabled: vi.fn(() => true),
}))
vi.mock('@/lib/authz/folder-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz/folder-access')>()),
  requireFolderWrite: vi.fn(async () => undefined),
}))
vi.mock('./announce', () => ({
  announceWaiting: vi.fn(async () => true),
  announceHeld: vi.fn(async () => true),
  announceDecided: vi.fn(async () => true),
  announceFilingFailed: vi.fn(async () => true),
  settleFilingFailed: vi.fn(async () => undefined),
  settleHeld: vi.fn(async () => undefined),
  settleProjectNotices: vi.fn(async () => undefined),
}))
vi.mock('./quiet-batch', () => ({
  openQuietBatch: vi.fn(async () => crypto.randomUUID()),
  sealQuietBatch: vi.fn(async () => undefined),
}))
vi.mock('@/lib/inbox/service', () => ({
  resolveInboxItemsAnchoredOn: vi.fn(async () => undefined),
}))
vi.mock('@/lib/documents/document-dispatch', () => ({ uploadDocument: vi.fn() }))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now().toString(36)
const ORG = `org_review_first_${STAMP}`
const MEMBER_ID = 'user_01J0REVIEWFIRST0000000000A'
const MEMBER_EMAIL = 'anna@buero-muster.at'
const TOKEN = (STAMP + 'rvfst')
  .replace(/[^a-z2-7]/g, 'a')
  .padEnd(12, 'q')
  .slice(-12)

describe.skipIf(!url)('review first: nothing is filed without a person’s decision, the verified writer’s own included', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let projectId: string
  let addressId: string
  let folderId: string
  let mailId: string
  let hostile: typeof import('./__fixtures__/hostile')
  let delivery = 0
  const session = {
    userId: MEMBER_ID,
    email: MEMBER_EMAIL,
    organizationId: ORG,
    organizationMembershipId: 'om_review_first',
    role: 'member',
    permissions: ['project:documents:write'],
  } as unknown as import('@/lib/auth/types').AuthorizedSession

  const inTenant = <T>(run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId: ORG, userId: MEMBER_ID }, run)
  async function rows<T>(statement: ReturnType<typeof sql>): Promise<T[]> {
    return Array.from(await inTenant(() => db.execute(statement))) as T[]
  }
  const documentCount = async () =>
    Number(
      (
        await rows<{ count: string }>(
          sql`SELECT count(*) FROM documents WHERE project_id = ${projectId}::uuid`
        )
      )[0]!.count
    )
  const jobKinds = async () =>
    (
      Array.from(
        await withPlatformAccess('spec', () =>
          db.execute(sql`SELECT kind FROM bff_job_queue WHERE lane = ${ORG} ORDER BY kind`)
        )
      ) as Array<{ kind: string }>
    ).map((row) => row.kind)

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    vi.stubEnv('INBOUND_MAIL_DOMAIN', 'example.org')
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    hostile = await import('./__fixtures__/hostile')
    store.dns = hostile.fakeDns(hostile.keyFor(hostile.MEMBER_DOMAIN))
    const { loadOrganizationDirectory } = await import('@/lib/sharing/directory')
    vi.mocked(loadOrganizationDirectory).mockResolvedValue(
      new Map([
        [
          MEMBER_ID,
          { userId: MEMBER_ID, email: MEMBER_EMAIL, name: 'Anna Muster', profilePictureUrl: null },
        ],
      ])
    )
    const { readMail } = await import('./read-client')
    vi.mocked(readMail).mockResolvedValue({
      readerVersion: 1,
      bodySource: 'plain',
      ownText: 'Hallo, anbei die Unterlagen.',
      ownTextTruncated: false,
      split: true,
      signatureRemoved: true,
      quoted: [],
      quotedTruncated: false,
      calendar: [],
      calendarTruncated: false,
      encrypted: false,
      unreadableReasons: [],
      unreadable: false,
    })

    projectId = (
      await rows<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, 'Wohnbau Hietzing', ${MEMBER_ID}, ${`coll_review_first_${STAMP}`}) RETURNING id`)
    )[0]!.id
    folderId = (
      await rows<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, project_id, name, path)
        VALUES (${ORG}, ${projectId}::uuid, 'Statik', 'Statik') RETURNING id`)
    )[0]!.id
    addressId = (
      await rows<{ id: string }>(sql`
        INSERT INTO inbound_mail_addresses (organization_id, project_id, token, slug, created_by)
        VALUES (${ORG}, ${projectId}::uuid, ${TOKEN}, 'wohnbau', ${MEMBER_ID}) RETURNING id`)
    )[0]!.id

    // A perfect mail: the member's, signed for real, to the project, with a PDF.
    const raw = await hostile.sign(
      hostile.message(
        hostile.multipart('mixed', [
          hostile.BODY,
          hostile.attachment('S-101_C.pdf', 'application/pdf', hostile.pdf('S-101 C')),
        ]),
        {
          To: `project+wohnbau.${TOKEN}@example.org`,
          Date: new Date(Date.now() - 60_000).toUTCString(),
        }
      )
    )
    mailId = await stage(raw)
  })

  /** Stage a raw message as the webhook does (`received`, its bytes in the store); its id. */
  async function stage(raw: string): Promise<string> {
    const id = crypto.randomUUID()
    delivery += 1
    const rawKey = `org/${ORG}/project/${projectId}/_inbound-mail/${id}/raw.eml`
    store.objects.set(rawKey, hostile.bytes(raw))
    await rows(sql`
      INSERT INTO inbound_mails (id, organization_id, project_id, address_id, status, delivery_key, envelope_from, raw_size_bytes, staging_bucket, raw_storage_key, expires_at)
      VALUES (${id}::uuid, ${ORG}, ${projectId}::uuid, ${addressId}::uuid, 'received', ${String(delivery).padStart(64, 'e')}, ${MEMBER_EMAIL}, ${raw.length}, 'org-test-bucket', ${rawKey}, now() + interval '30 days')`)
    return id
  }

  /** A signed mail of the member's with one PDF; `headers` as `hostile.message` takes them. */
  async function memberMail(file: string, headers: Record<string, string | null>, signed = true): Promise<string> {
    const raw = hostile.message(
      hostile.multipart('mixed', [hostile.BODY, hostile.attachment(file, 'application/pdf', hostile.pdf(file))]),
      { To: `project+wohnbau.${TOKEN}@example.org`, Date: new Date(Date.now() - 60_000).toUTCString(), ...headers },
    )
    return signed ? hostile.sign(raw) : raw
  }

  const classOf = async (id: string) =>
    (await rows<{ sender_class: string; sender_trust: string; status: string }>(
      sql`SELECT sender_class, sender_trust, status FROM inbound_mails WHERE id = ${id}::uuid`,
    ))[0]
  const receive = async (id: string) => {
    const { runInboundMailReceive } = await import('./receive-job')
    await inTenant(() => runInboundMailReceive(ORG, { mailId: id, projectId }, { last: false }))
  }

  afterAll(async () => {
    vi.unstubAllEnvs()
    await withPlatformAccess('test cleanup', () =>
      db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`)
    )
    await withPlatformAccess('test cleanup', () =>
      db.execute(sql`DELETE FROM bff_job_queue WHERE lane = ${ORG}`)
    )
  })

  it('1. holds a signed mail of a member without write rights: no document, no write outside its staging, no job that files', async () => {
    await receive(mailId)

    expect(await classOf(mailId)).toEqual({ status: 'waiting', sender_trust: 'member_verified', sender_class: 'office_member' })
    expect(
      await rows(
        sql`SELECT kind, state FROM inbound_mail_parts WHERE mail_id = ${mailId}::uuid ORDER BY position`
      )
    ).toEqual([
      { kind: 'message', state: 'waiting' },
      { kind: 'attachment', state: 'waiting' },
    ])
    expect(await documentCount()).toBe(0)
    expect(store.writes.length).toBeGreaterThan(0)
    expect(
      store.writes.every((key) =>
        key.startsWith(`org/${ORG}/project/${projectId}/_inbound-mail/${mailId}/`)
      )
    ).toBe(true)
    expect(await jobKinds()).not.toContain('inbound_mail_file')
    expect(await jobKinds()).not.toContain('inbound_mail_follow')
    expect(await jobKinds()).not.toContain('inbound_mail_sender_file')
  })

  it('2. files nothing when the filing job runs before anyone decided', async () => {
    const { runInboundMailFiling } = await import('./file-job')
    const { uploadDocument } = await import('@/lib/documents/document-dispatch')
    const requester = {
      userId: MEMBER_ID,
      email: MEMBER_EMAIL,
      organizationMembershipId: 'om_review_first',
      role: 'member',
      permissions: [],
    }
    expect(
      await inTenant(() =>
        runInboundMailFiling(session, { projectId, mailIds: [mailId], requester })
      )
    ).toMatchObject({ done: true })
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(await documentCount()).toBe(0)
  })

  it('3. files exactly what the person decided, as that person, and the text becomes nothing', async () => {
    const repository = await import('./repository')
    const { runInboundMailFiling } = await import('./file-job')
    const { uploadDocument } = await import('@/lib/documents/document-dispatch')
    vi.mocked(uploadDocument).mockImplementation(async (asWho, input) => {
      const [row] = Array.from(
        await db.execute(sql`
          INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id)
          VALUES (${asWho.organizationId}, ${asWho.userId}, ${input.file.name}, ${`k/${STAMP}/upload`}, ${`coll_review_first_${STAMP}`}, 'completed', 'project', ${input.projectId}::uuid, ${input.folderId}::uuid)
          RETURNING id`)
      ) as Array<{ id: string }>
      await db.execute(sql`
        INSERT INTO document_versions (organization_id, document_id, project_id, version_number, state, storage_key, created_by, approved_by, approved_at)
        VALUES (${asWho.organizationId}, ${row!.id}::uuid, ${input.projectId}::uuid, 1, 'superseded', ${`k/${STAMP}/upload/v1`}, ${asWho.userId}, ${asWho.userId}, now())`)
      return { documentId: row!.id, jobId: 'job', status: 'pending', filename: input.file.name }
    })

    const parts = await inTenant(() => repository.findMailParts([mailId]))
    const file = parts.find((part) => part.kind === 'attachment')!
    const decisionId = crypto.randomUUID()
    await inTenant(() =>
      repository.writeMailDecisions(
        [
          {
            mailId,
            ifMatch: 'read',
            files: [
              {
                id: decisionId,
                organizationId: ORG,
                projectId,
                mailId,
                partId: file.id,
                action: 'file',
                decidedBy: MEMBER_ID,
                via: 'app',
                proposalId: null,
                folderId: null,
                folderPath: '',
                fileName: 'S-101_C.pdf',
                documentType: null,
              },
            ],
          },
        ],
        { decidedBy: MEMBER_ID, via: 'app', proposalId: null },
        () => 'read',
        new Date(Date.now() + 300_000),
        null
      )
    )

    const requester = {
      userId: MEMBER_ID,
      email: MEMBER_EMAIL,
      organizationMembershipId: 'om_review_first',
      role: 'member',
      permissions: [],
    }
    await inTenant(() => runInboundMailFiling(session, { projectId, mailIds: [mailId], requester }))

    expect(uploadDocument).toHaveBeenCalledOnce()
    const [asWho, input] = vi.mocked(uploadDocument).mock.calls[0]!
    expect(asWho.userId).toBe(MEMBER_ID)
    expect(input.file.name).toBe('S-101_C.pdf')
    expect(await documentCount()).toBe(1)
    expect(
      await rows(
        sql`SELECT kind, state, storage_key IS NULL AS erased FROM inbound_mail_parts WHERE mail_id = ${mailId}::uuid ORDER BY position`
      )
    ).toEqual([
      { kind: 'message', state: 'dismissed', erased: true },
      { kind: 'attachment', state: 'filed', erased: true },
    ])
    expect(store.erased).toContain(file.storageKey)
    // What the filing then says it became (`filedAs`): the Fassung of the document it made, read per project.
    const filedPart = (await inTenant(() => repository.findMailParts([mailId]))).find((part) => part.kind === 'attachment')
    expect(filedPart?.documentVersionId).toEqual(expect.any(String))
    const versionId = filedPart?.documentVersionId as string
    expect(await inTenant(() => repository.findVersionNumbers(projectId, [versionId]))).toEqual(new Map([[versionId, 1]]))
    expect(await inTenant(() => repository.findVersionNumbers(crypto.randomUUID(), [versionId]))).toEqual(new Map())
    expect(
      (
        await rows<{ count: string }>(
          sql`SELECT count(*) FROM mail_thread_entries WHERE project_id = ${projectId}::uuid`
        )
      )[0]!.count
    ).toBe('0')
  })

  it('4. files a writer’s own signed mail directly, as them: a decision via sender, an upload in their name', async () => {
    const { runInboundMailSenderFile, SENDER_FILE_MAX_WAITS } = await import('./sender-file-job')
    const { runInboundMailFiling } = await import('./file-job')
    const { resolvePinnedRequesterSessionStrict } = await import('@/lib/auth/pinned-session')
    const { uploadDocument } = await import('@/lib/documents/document-dispatch')
    vi.mocked(resolvePinnedRequesterSessionStrict).mockResolvedValue(session)
    vi.mocked(uploadDocument).mockClear()
    store.memberWrites = true
    // The text the reader could not read waits for its sender (a flagged part is never filed without a click); the attachment goes.
    const { readMail } = await import('./read-client')
    const read = await readMail('unused')
    vi.mocked(readMail).mockResolvedValueOnce({ ...read, unreadable: true, unreadableReasons: ['failed'] })
    const direct = await stage(await memberMail('S-102_A.pdf', { 'Message-ID': '<m4@buero-muster.at>' }))
    const before = await documentCount()

    await receive(direct)
    expect(await classOf(direct)).toEqual({ status: 'waiting', sender_trust: 'member_verified', sender_class: 'verified_writer' })
    expect(await jobKinds()).toContain('inbound_mail_sender_file')
    // The agent's suggestion, as the suggest job would store it: the attachment's confident place.
    await rows(sql`
      UPDATE inbound_mail_parts SET suggestion = ${JSON.stringify({ folderId, folderPath: 'Statik', newFolder: false, documentType: null, reason: 'Statik' })}::jsonb
       WHERE mail_id = ${direct}::uuid AND kind = 'attachment'`)

    await inTenant(() => runInboundMailSenderFile(ORG, { mailId: direct, projectId, waits: SENDER_FILE_MAX_WAITS }, { last: false }))
    expect(
      await rows(sql`SELECT d.via, d.decided_by, p.kind, p.state FROM inbound_mail_decisions d JOIN inbound_mail_parts p ON p.id = d.part_id WHERE d.mail_id = ${direct}::uuid`),
    ).toEqual([{ via: 'sender', decided_by: MEMBER_ID, kind: 'attachment', state: 'filing' }])
    const [job] = Array.from(
      await withPlatformAccess('spec', () =>
        db.execute(sql`SELECT payload FROM bff_job_queue WHERE lane = ${ORG} AND kind = 'inbound_mail_file' AND payload->'mailIds' ? ${direct}`),
      ),
    ) as Array<{ payload: import('@/lib/jobs-queue/types').InboundMailFilePayload }>
    expect(job?.payload.requester.userId).toBe(MEMBER_ID)

    await inTenant(() => runInboundMailFiling(session, job!.payload))
    expect(uploadDocument).toHaveBeenCalledOnce()
    expect(vi.mocked(uploadDocument).mock.calls[0]![0].userId).toBe(MEMBER_ID)
    expect(await documentCount()).toBe(before + 1)
    expect(
      await rows(sql`SELECT kind, state FROM inbound_mail_parts WHERE mail_id = ${direct}::uuid ORDER BY position`),
    ).toEqual([
      { kind: 'message', state: 'waiting' },
      { kind: 'attachment', state: 'filed' },
    ])
  })

  it('5. holds a writer’s address whose signature fails, and a spoofed From of that writer: filed by nobody but them', async () => {
    const { runInboundMailSenderFile, SENDER_FILE_MAX_WAITS } = await import('./sender-file-job')
    const repository = await import('./repository')
    store.memberWrites = true
    const signedDns = store.dns
    store.dns = hostile.fakeDns({})
    const failed = await stage(await memberMail('S-103.pdf', { 'Message-ID': '<m5@buero-muster.at>' }))
    await receive(failed)
    store.dns = signedDns
    const spoofed = await stage(await memberMail('Kontoaenderung.pdf', { 'Message-ID': '<m6@buero-muster.at>' }, false))
    await receive(spoofed)
    const before = await documentCount()

    for (const id of [failed, spoofed]) {
      expect(await classOf(id)).toEqual({ status: 'waiting', sender_trust: 'member_unverified', sender_class: 'unverified_writer' })
      expect(
        await inTenant(() => runInboundMailSenderFile(ORG, { mailId: id, projectId, waits: SENDER_FILE_MAX_WAITS }, { last: false })),
      ).toMatchObject({ done: true })
      const part = (await inTenant(() => repository.findMailParts([id]))).find((candidate) => candidate.kind === 'attachment')!
      await expect(
        inTenant(() =>
          repository.writeMailDecisions(
            [{ mailId: id, ifMatch: 'read', keepOthers: true, files: [{ organizationId: ORG, projectId, mailId: id, partId: part.id, action: 'file', decidedBy: MEMBER_ID, via: 'sender', proposalId: null, folderId: null, folderPath: '', fileName: 'x.pdf', documentType: null }] }],
            { decidedBy: MEMBER_ID, via: 'sender', proposalId: null },
            () => 'read',
            new Date(Date.now() + 300_000),
            null,
          ),
        ),
      ).rejects.toSatisfy((error: unknown) => /sender_files_own_verified_mail|only a verified writer/.test(String((error as { cause?: unknown }).cause ?? error)))
    }
    expect(await documentCount()).toBe(before)
    expect(await rows(sql`SELECT 1 FROM inbound_mail_decisions WHERE mail_id IN (${failed}::uuid, ${spoofed}::uuid)`)).toEqual([])
  })

  it('6. holds an outsider’s mail for 14 days, and files nothing', async () => {
    store.memberWrites = true
    const before = await documentCount()
    const raw = hostile.message(hostile.BODY, {
      From: 'Wer Auch Immer <x@stranger.example>',
      To: `project+wohnbau.${TOKEN}@example.org`,
      'Message-ID': '<m7@stranger.example>',
    })
    const outsider = await stage(raw)
    await receive(outsider)

    expect(await classOf(outsider)).toEqual({ status: 'waiting', sender_trust: 'external_unverified', sender_class: 'external' })
    const [window] = await rows<{ days: number }>(
      sql`SELECT round(extract(epoch FROM expires_at - received_at) / 86400)::int AS days FROM inbound_mails WHERE id = ${outsider}::uuid`,
    )
    expect(window?.days).toBe(14)
    expect(await documentCount()).toBe(before)
  })
})

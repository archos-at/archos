// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('server-only', () => ({}))

const s3Send = vi.fn()
vi.mock('@/lib/s3', () => ({
  s3Client: { send: (...args: unknown[]) => s3Send(...args) },
  bucketAdminS3Client: {},
  buildStorageKey: (
    organizationId: string,
    projectId: string,
    documentId: string,
    filename: string,
    folderPath?: string | null,
  ) => `org/${organizationId}/project/${projectId}/${folderPath ?? ''}/doc/${documentId}/${filename}`,
}))

const ensureTenantBucketChecked = vi.fn()
vi.mock('@/lib/storage/bucket', () => ({
  ensureTenantBucketChecked: (...args: unknown[]) => ensureTenantBucketChecked(...args),
}))

const admitOrDiscard = vi.fn()
vi.mock('@/lib/storage/admission', () => ({
  admitOrDiscard: (...args: unknown[]) => admitOrDiscard(...args),
}))

const requireProjectAccess = vi.fn()
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const recordAuditEventOrThrow = vi.fn()
vi.mock('@/lib/audit/service', () => ({
  recordAuditEventOrThrow: (...args: unknown[]) => recordAuditEventOrThrow(...args),
}))

const findProjectInOrg = vi.fn()
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: (...args: unknown[]) => findProjectInOrg(...args),
}))

const getOrCreateProjectFolderByName = vi.fn()
const findRootProjectFolderByName = vi.fn()
vi.mock('@/lib/projects/folder-service', () => ({
  getOrCreateProjectFolderByName: (...args: unknown[]) => getOrCreateProjectFolderByName(...args),
  findRootProjectFolderByName: (...args: unknown[]) => findRootProjectFolderByName(...args),
}))

const recordedRestrictedFolders = vi.fn()
vi.mock('@/lib/conversations/restricted-use', () => ({
  recordedRestrictedFolders: (...args: unknown[]) => recordedRestrictedFolders(...args),
  recordedSourceProjects: async () => [],
}))
const listProjectFolderTree = vi.fn()
vi.mock('@/lib/authz/folder-access-repository', () => ({
  listProjectFolderTree: (...args: unknown[]) => listProjectFolderTree(...args),
}))

const findDocumentAuthoredByRef = vi.fn()
const deleteProjectDocument = vi.fn()
vi.mock('./repository', () => ({
  findDocumentAuthoredByRef: (...args: unknown[]) => findDocumentAuthoredByRef(...args),
  deleteProjectDocument: (...args: unknown[]) => deleteProjectDocument(...args),
}))

const dispatchDocument = vi.fn()
const dispatchIngest = vi.fn()
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: (...args: unknown[]) => dispatchDocument(...args),
}))
vi.mock('@/lib/documents/ingest-dispatch', () => ({
  dispatchIngest: (...args: unknown[]) => dispatchIngest(...args),
}))

import {
  ConversationConfinedError,
  ForbiddenError,
  InsufficientStorageError,
  NotFoundError,
} from '@/lib/api/errors'
import { folderReadOnlyError, requireFolderWrite } from '@/lib/authz/folder-access'
import type { NewDocument } from '@/lib/db/schema/documents'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeProject } from '@/test-utils/db-fixtures'
import { AUDIT_SCHEMAS } from '@/lib/audit/schemas.mjs'
import { aiProvenanceMarking } from '@/lib/ai-provenance'
import {
  GENERATED_DOCUMENT_FOLDER_NAME,
  GENERATED_DOCUMENT_PRODUCERS,
  GENERATED_DOCUMENT_PRODUCER_REF_KINDS,
  UnmarkedRenderingError,
  fileGeneratedDocument,
  generatedDocumentMarking,
  generatedFilename,
  resolveGeneratedDocumentDestination,
} from './generated'
import type { GeneratedRenderContext } from './generated'
import { PRODUCT_NAME } from '@/lib/brand'

const SESSION = {
  userId: 'user-1',
  email: 'architektin@example.at',
  name: 'Architektin',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'editor',
  permissions: ['project:documents:write'],
  featureFlags: null,
} as AuthorizedSession

const FOLDER = {
  id: 'folder-1',
  projectId: 'proj-1',
  parentId: null,
  name: GENERATED_DOCUMENT_FOLDER_NAME,
  path: GENERATED_DOCUMENT_FOLDER_NAME,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
}

const renderedBytes = (marking: string) => new TextEncoder().encode(`report ${marking}`)

const render = vi.fn((context: GeneratedRenderContext) => ({
  bytes: renderedBytes(context.marking),
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  marking: context.marking,
}))

const REPORT_MARKING = aiProvenanceMarking({ runId: 'run_7' })

const file = () =>
  fileGeneratedDocument({
    session: SESSION,
    projectId: 'proj-1',
    producer: 'deep_research',
    ref: 'run_7',
    title: 'Brandschutz Straßenhäuser',
    render,
  })

const admittedRow = (): NewDocument => admitOrDiscard.mock.calls[0][2] as NewDocument

const sentCommands = <T>(kind: abstract new (...args: never[]) => T): T[] =>
  s3Send.mock.calls
    .map(([command]) => command as unknown)
    .filter((command): command is T => command instanceof kind)

const onlyPut = (): PutObjectCommand => {
  const puts = sentCommands(PutObjectCommand)
  expect(puts, 'exactly one object is written per filed document').toHaveLength(1)
  return puts[0]
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectAccess.mockResolvedValue({ role: 'editor' })
  findDocumentAuthoredByRef.mockResolvedValue(null)
  findProjectInOrg.mockResolvedValue(makeProject({ id: 'proj-1', collectionName: 'proj_abc' }))
  getOrCreateProjectFolderByName.mockResolvedValue(FOLDER)
  findRootProjectFolderByName.mockResolvedValue(FOLDER)
  recordedRestrictedFolders.mockResolvedValue([])
  listProjectFolderTree.mockResolvedValue([])
  ensureTenantBucketChecked.mockResolvedValue('grid-org-org-1')
  s3Send.mockResolvedValue({})
  admitOrDiscard.mockResolvedValue(undefined)
  recordAuditEventOrThrow.mockResolvedValue(undefined)
  deleteProjectDocument.mockResolvedValue(undefined)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this spec'))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'doc-uuid' })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fileGeneratedDocument', () => {
  it('files the bytes as an agent-authored row the quota ledger can see', async () => {
    const result = await file()

    expect(s3Send).toHaveBeenCalledTimes(1)
    expect(s3Send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand)
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)

    const row = admittedRow()
    expect(row.authoredBy).toBe('agent')
    expect(row.authoredByProducer).toBe('deep_research')
    expect(row.authoredByRef).toBe('run_7')
    expect(row.authoredByRefKind).toBe('agent_run')
    expect(row.status).toBe('stored')
    expect(row.createdBy).toBe('user-1')
    expect(row.folderId).toBe('folder-1')
    expect(row.organizationId).toBe('org-1')
    expect(row.projectId).toBe('proj-1')
    expect(row.fileSize).toBe(renderedBytes(REPORT_MARKING).byteLength)
    expect(row.visibility).toBeUndefined()
    expect(result.alreadyFiled).toBe(false)
    expect(result.documentId).toBe(row.id)
  })

  it('lands in the destination the resolver names', async () => {
    await file()
    expect(getOrCreateProjectFolderByName).toHaveBeenCalledWith('proj-1', 'Berichte', 'org-1')
  })

  describe('the row and its object are the same file', () => {
    it('PUTs the rendered bytes, whole, under the tenant bucket and the built key', async () => {
      await file()

      const put = onlyPut()
      const row = admittedRow()

      expect(put.input.Body).toEqual(Buffer.from(renderedBytes(REPORT_MARKING)))
      expect(row.fileSize).toBe(renderedBytes(REPORT_MARKING).byteLength)
      expect(put.input.ContentType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      expect(put.input.Bucket).toBe('grid-org-org-1')
      expect(put.input.Key).toBe(
        `org/org-1/project/proj-1/Berichte/doc/${row.id}/${row.filename}`,
      )
    })

    it('tells admission about the object it actually wrote', async () => {
      await file()

      const put = onlyPut()
      expect(admitOrDiscard.mock.calls[0][0]).toBe(put.input.Bucket)
      expect(admitOrDiscard.mock.calls[0][1]).toBe(put.input.Key)
    })

    it('records that same location on the row', async () => {
      await file()

      const put = onlyPut()
      const row = admittedRow()
      expect(row.storageKey).toBe(put.input.Key)
      expect(row.storageBucket).toBe(put.input.Bucket)
    })

    it('names the file the same way in the row as in the key', async () => {
      await file()

      const row = admittedRow()
      expect(row.filename).toMatch(/^brandschutz-strassenhaeuser-\d{4}-\d{2}-\d{2}\.docx$/)
      expect(row.storageKey?.endsWith(`/${row.filename}`)).toBe(true)
      expect(row.displayName).toBe('Brandschutz Straßenhäuser')
      expect(row.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
    })

    describe('the filename namespace', () => {
      const fileDocument = () =>
        fileGeneratedDocument({
          session: SESSION,
          projectId: 'proj-1',
          producer: 'agent_document',
          ref: 's_conv_1-aktenvermerk',
          title: 'Aktenvermerk',
          render: async ({ marking }) => ({
            bytes: new TextEncoder().encode(`# Aktenvermerk\n\n\`\`\`\n${marking}\n\`\`\`\n`),
            contentType: 'text/markdown',
            marking,
          }),
        })

      it('files a publishable Piloti document under piloti/<document id>/', async () => {
        const result = await fileDocument()

        const row = admittedRow()
        expect(row.filename).toBe(`piloti/${row.id}/${result.filename.split('/').pop()}`)
        expect(row.filename).toMatch(/^piloti\/[^/]+\/aktenvermerk-\d{4}-\d{2}-\d{2}\.md$/)
      })

      it('keeps the object key flat, under the document’s own prefix', async () => {
        await fileDocument()

        const put = onlyPut()
        const row = admittedRow()
        expect(put.input.Key).toMatch(/\/doc\/[^/]+\/aktenvermerk-\d{4}-\d{2}-\d{2}\.md$/)
        expect(put.input.Key).not.toContain('piloti')
        expect(row.storageKey).toBe(put.input.Key)
      })

      it('shows the title, never the namespaced name, to a reader', async () => {
        await fileDocument()

        expect(admittedRow().displayName).toBe('Aktenvermerk')
      })

      it('leaves a producer whose output is never published unnamespaced', async () => {
        await file()

        expect(admittedRow().filename).not.toContain('piloti/')
      })
    })

    it('files the row into the project corpus it belongs to', async () => {
      await file()

      expect(admittedRow().collectionName).toBe('proj_abc')
    })
  })

  describe('a machine-authored file says so in its own bytes', () => {
    it('hands the producer the marking rather than letting it choose one', async () => {
      await file()

      expect(render.mock.calls[0][0].marking).toBe(REPORT_MARKING)
      expect(REPORT_MARKING).toBe(
        `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia; AIRunId=run_7`,
      )
    })

    it('carries no run id for a reference that is not a run', () => {
      expect(generatedDocumentMarking('diagram_svg', 'msg_42-1a2b3c4d')).toBe(
        `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`,
      )
      expect(generatedDocumentMarking('diagram_pdf', 'msg_42-1a2b3c4d')).toBe(
        `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`,
      )
    })

    it('refuses bytes that do not carry the marking, and stores nothing', async () => {
      render.mockImplementationOnce((context) => ({
        bytes: new TextEncoder().encode('a report with nothing in it about who wrote it'),
        contentType: 'application/pdf',
        marking: context.marking,
      }))

      await expect(file()).rejects.toBeInstanceOf(UnmarkedRenderingError)

      expect(getOrCreateProjectFolderByName).not.toHaveBeenCalled()
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
      expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
    })

    it('refuses a marking the producer built for itself', async () => {
      const wrong = aiProvenanceMarking({})
      render.mockImplementationOnce(() => ({
        bytes: renderedBytes(wrong),
        contentType: 'application/pdf',
        marking: wrong,
      }))

      await expect(file()).rejects.toBeInstanceOf(UnmarkedRenderingError)
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })
  })

  describe('the ouroboros test — a generated document is never ingested', () => {
    it('makes no ingest dispatch and no HTTP request at all while filing', async () => {
      await file()

      expect(dispatchDocument).not.toHaveBeenCalled()
      expect(dispatchIngest).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('cannot acquire an ingest path without this spec failing', () => {
      const source = readFileSync(new URL('./generated.ts', import.meta.url), 'utf8')
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toMatch(/dispatchDocument|dispatchIngest|\/v1\/ingest/)
      expect(code).not.toMatch(/from '(\.\/service|@\/lib\/documents\/service)'/)
    })
  })

  it('refuses a session without project:documents:write, before any byte is written', async () => {
    requireProjectAccess.mockRejectedValue(new ForbiddenError('project:documents:write required'))

    await expect(file()).rejects.toBeInstanceOf(ForbiddenError)

    expect(render).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('requires the write permission with the legacy umbrella the upload path accepts', async () => {
    await file()
    expect(requireProjectAccess).toHaveBeenCalledWith(SESSION, 'proj-1', [
      'project:documents:write',
      'project:edit',
    ])
  })

  describe('project:documents:generate', () => {
    const grantAllBut = (withheld: string) =>
      requireProjectAccess.mockImplementation(
        async (_session: unknown, _projectId: string, permission: string | readonly string[]) => {
          const asked = Array.isArray(permission) ? permission : [permission as string]
          if (asked.includes(withheld)) throw new ForbiddenError(`${withheld} required`)
          return { role: 'editor' }
        },
      )

    it('is required IN ADDITION to the write permission, not instead of it', async () => {
      await file()

      expect(requireProjectAccess.mock.calls.map((call) => call[2])).toEqual([
        ['project:documents:write', 'project:edit'],
        'project:documents:generate',
      ])
    })

    it('does NOT accept the legacy project:edit umbrella for machine authorship', async () => {
      await file()

      const asked = requireProjectAccess.mock.calls
        .map((call) => call[2])
        .filter((permission: string | readonly string[]) =>
          (Array.isArray(permission) ? permission : [permission as string]).includes(
            'project:documents:generate',
          ),
        )
      expect(asked).toEqual(['project:documents:generate'])
    })

    it('refuses a session that may upload but may not generate, before any byte is written', async () => {
      grantAllBut('project:documents:generate')

      await expect(file()).rejects.toBeInstanceOf(ForbiddenError)

      expect(render).not.toHaveBeenCalled()
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
      expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
    })

    it('still refuses a session that may generate but may not write documents', async () => {
      grantAllBut('project:documents:write')

      await expect(file()).rejects.toBeInstanceOf(ForbiddenError)
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })

    it('gates every producer, because the gate is on the service and not on a route', async () => {
      grantAllBut('project:documents:generate')

      for (const producer of GENERATED_DOCUMENT_PRODUCERS) {
        await expect(
          fileGeneratedDocument({
            session: SESSION,
            projectId: 'proj-1',
            producer,
            ref: 'ref-1',
            title: 'Ablauf',
            render,
          }),
        ).rejects.toBeInstanceOf(ForbiddenError)
      }
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })
  })

  describe('the agent-authored-documents feature flag', () => {
    it('files where nobody signs in — a rollout is on there', async () => {
      await file()
      expect(admitOrDiscard).toHaveBeenCalledTimes(1)
    })

    it('refuses when the organization lacks the flag, before any permission is read', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')

      await expect(
        fileGeneratedDocument({
          session: { ...SESSION, featureFlags: [] },
          projectId: 'proj-1',
          producer: 'deep_research',
          ref: 'run_7',
          title: 'Brandschutz',
          render,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)

      expect(requireProjectAccess).not.toHaveBeenCalled()
      expect(render).not.toHaveBeenCalled()
      expect(s3Send).not.toHaveBeenCalled()
    })

    it('follows the per-org WorkOS flag where people sign in', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')

      await expect(
        fileGeneratedDocument({
          session: { ...SESSION, featureFlags: [] },
          projectId: 'proj-1',
          producer: 'deep_research',
          ref: 'run_7',
          title: 'Brandschutz',
          render,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect(admitOrDiscard).not.toHaveBeenCalled()

      await fileGeneratedDocument({
        session: { ...SESSION, featureFlags: ['agent-authored-documents'] },
        projectId: 'proj-1',
        producer: 'deep_research',
        ref: 'run_7',
        title: 'Brandschutz',
        render,
      })
      expect(admitOrDiscard).toHaveBeenCalledTimes(1)
    })
  })

  it('surfaces a quota refusal and leaves no row — admission has already taken the object back', async () => {
    const refusal = new InsufficientStorageError('no room', {
      quotaBytes: 10,
      usedBytes: 10,
      requestedBytes: 5,
    })
    admitOrDiscard.mockRejectedValue(refusal)

    await expect(file()).rejects.toBe(refusal)

    expect(deleteProjectDocument).not.toHaveBeenCalled()
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('files a project that does not exist as a 404 rather than as an orphan object', async () => {
    findProjectInOrg.mockResolvedValue(null)
    await expect(file()).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Send).not.toHaveBeenCalled()
  })

  describe('idempotency', () => {
    it('returns the existing document when this run was already filed', async () => {
      findDocumentAuthoredByRef.mockResolvedValue({
        id: 'doc-existing',
        filename: 'brandschutz-2026-08-20.docx',
        folderId: 'folder-1',
      })

      const result = await file()

      expect(result).toEqual({
        documentId: 'doc-existing',
        filename: 'brandschutz-2026-08-20.docx',
        folderId: 'folder-1',
        alreadyFiled: true,
      })
      expect(render).not.toHaveBeenCalled()
      expect(s3Send).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
    })

    it('files the same run twice into one document', async () => {
      const first = await file()
      findDocumentAuthoredByRef.mockResolvedValue({
        id: first.documentId,
        filename: first.filename,
        folderId: first.folderId,
      })
      const second = await file()

      expect(second.documentId).toBe(first.documentId)
      expect(second.alreadyFiled).toBe(true)
      expect(admitOrDiscard).toHaveBeenCalledTimes(1)
    })

    it('files ONE document and leaves ONE object when two tabs file the same run at once', async () => {
      const filedByRef = new Map<string, NewDocument>()
      let probes = 0

      let minted = 0
      vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `doc-${++minted}` })

      findDocumentAuthoredByRef.mockImplementation(async (ref: string) => {
        if (++probes <= 2) return null
        const row = filedByRef.get(ref)
        return row ? { id: row.id, filename: row.filename, folderId: row.folderId } : null
      })

      admitOrDiscard.mockImplementation(async (bucket: string, key: string, row: NewDocument) => {
        const ref = row.authoredByRef ?? ''
        if (!filedByRef.has(ref)) {
          filedByRef.set(ref, row)
          return
        }
        await s3Send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        throw new Error('Failed query: insert into "documents" …', {
          cause: Object.assign(
            new Error(
              'duplicate key value violates unique constraint "uniq_documents_authored_ref_producer_per_project"',
            ),
            { code: '23505', constraint_name: 'uniq_documents_authored_ref_producer_per_project' },
          ),
        })
      })

      const [first, second] = await Promise.all([file(), file()])

      expect(filedByRef.size).toBe(1)
      const winner = filedByRef.get('run_7')
      expect(first.documentId).toBe(winner?.id)
      expect(second.documentId).toBe(winner?.id)
      expect(first.filename).toBe(winner?.filename)
      expect(second.filename).toBe(winner?.filename)
      expect([first.alreadyFiled, second.alreadyFiled].sort()).toEqual([false, true])

      const puts = sentCommands(PutObjectCommand)
      const deletes = sentCommands(DeleteObjectCommand)
      expect(puts).toHaveLength(2)
      expect(deletes).toHaveLength(1)
      const surviving = puts
        .map((put) => put.input.Key)
        .filter((key) => key !== deletes[0].input.Key)
      expect(surviving).toEqual([winner?.storageKey])

      expect(recordAuditEventOrThrow).toHaveBeenCalledTimes(1)
      expect(deleteProjectDocument).not.toHaveBeenCalled()
    })

    it('re-throws a unique violation the re-probe cannot explain', async () => {
      admitOrDiscard.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      )

      await expect(file()).rejects.toThrow('duplicate key')
      expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
    })

    it('re-throws an admission failure that is not a unique violation', async () => {
      admitOrDiscard.mockRejectedValue(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      )

      await expect(file()).rejects.toThrow('deadlock detected')
      expect(findDocumentAuthoredByRef).toHaveBeenCalledTimes(1)
    })

    it('looks the run up by its own id, scoped to the organization AND the project', async () => {
      await file()
      expect(findDocumentAuthoredByRef).toHaveBeenCalledWith('run_7', 'org-1', 'proj-1', 'deep_research')
    })

    it('looks the run up by its PRODUCER too, so a run can owe more than one file', async () => {
      await fileGeneratedDocument({
        session: SESSION,
        projectId: 'proj-1',
        producer: 'diagram_pdf',
        ref: 'run_7',
        title: 'Ablauf',
        render,
      })
      expect(findDocumentAuthoredByRef).toHaveBeenCalledWith('run_7', 'org-1', 'proj-1', 'diagram_pdf')
    })
  })

  describe('audit', () => {
    it('emits document.generated with the agent actor and a TYPED reference', async () => {
      await file()

      const event = recordAuditEventOrThrow.mock.calls[0][0]
      expect(event.action).toBe('document.generated')
      expect(event.actor).toEqual({
        type: 'agent',
        userId: 'user-1',
        email: 'architektin@example.at',
        ref: { kind: 'agent_run', id: 'run_7' },
      })
      expect(event.targetType).toBe('document')
      expect(event.targetId).toBe(admittedRow().id)
      expect(event.metadata).toMatchObject({ projectId: 'proj-1', producer: 'deep_research' })
    })

    it('does not tell an auditor a diagram\u2019s reference is a job id', async () => {
      await fileGeneratedDocument({
        session: SESSION,
        projectId: 'proj-1',
        producer: 'diagram_svg',
        ref: 'msg_42-1a2b3c4d',
        title: 'Ablauf',
        render,
      })

      const event = recordAuditEventOrThrow.mock.calls[0][0]
      expect(event.actor.ref).toEqual({ kind: 'answer_artifact', id: 'msg_42-1a2b3c4d' })
      expect(admittedRow().authoredByRefKind).toBe('answer_artifact')
    })

    it('registers every reference kind it can emit as a target of the action', () => {
      const registered = AUDIT_SCHEMAS['document.generated'].targets.map((target) => target.type)
      for (const kind of Object.values(GENERATED_DOCUMENT_PRODUCER_REF_KINDS)) {
        expect(registered, kind).toContain(kind)
      }
    })

    it('unfiles the document when the audit write fails', async () => {
      const failure = new Error('audit rejected')
      recordAuditEventOrThrow.mockRejectedValue(failure)

      await expect(file()).rejects.toBe(failure)

      expect(deleteProjectDocument).toHaveBeenCalledWith(admittedRow().id, 'org-1', 'proj-1')
      const deletes = s3Send.mock.calls.filter(([command]) => command instanceof DeleteObjectCommand)
      expect(deletes).toHaveLength(1)
    })

    it('still fails the filing when the compensation itself fails', async () => {
      recordAuditEventOrThrow.mockRejectedValue(new Error('audit rejected'))
      deleteProjectDocument.mockRejectedValue(new Error('database gone'))

      await expect(file()).rejects.toThrow('audit rejected')
    })
  })
})

describe('filing out of a conversation that drew on a restricted folder (ADR-0087, ADR-0088)', () => {
  const CONTRACTS = 'folder-vertraege'
  const fileFromChat = () =>
    fileGeneratedDocument({
      session: SESSION,
      projectId: 'proj-1',
      producer: 'agent_document',
      ref: 's_conv_1-honorar',
      title: 'Honorarübersicht',
      render,
      origin: { conversationId: 's_conv_1', locale: 'de' },
    })
  const tree = (reportsUnderContracts: boolean) => [
    { id: CONTRACTS, parentId: null, accessMode: 'custom', grants: [{ role: 'org-gf', level: 'write' }] },
    { id: FOLDER.id, parentId: reportsUnderContracts ? CONTRACTS : null, accessMode: 'inherit', grants: [] },
  ]

  beforeEach(() => {
    recordedRestrictedFolders.mockResolvedValue([CONTRACTS])
    listProjectFolderTree.mockResolvedValue(tree(false))
  })

  it('refuses an open Berichte folder before anything is rendered, created or written', async () => {
    const error = await fileFromChat().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConversationConfinedError)
    expect((error as ConversationConfinedError).action).toBe('filing')
    expect(recordedRestrictedFolders).toHaveBeenCalledWith('s_conv_1', 'org-1')
    expect(listProjectFolderTree).toHaveBeenCalledWith('org-1', 'proj-1')
    expect(render).not.toHaveBeenCalled()
    expect(getOrCreateProjectFolderByName).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('judges a Berichte folder that does not exist yet as the open root folder it would become', async () => {
    findRootProjectFolderByName.mockResolvedValue(null)

    await expect(fileFromChat()).rejects.toBeInstanceOf(ConversationConfinedError)
    expect(getOrCreateProjectFolderByName).not.toHaveBeenCalled()
  })

  it('files into a Berichte folder whose path carries every folder the conversation drew on', async () => {
    listProjectFolderTree.mockResolvedValue(tree(true))

    await fileFromChat()

    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })

  it('files from a conversation that drew on nothing without reading the folder tree', async () => {
    recordedRestrictedFolders.mockResolvedValue([])
    await fileFromChat()

    expect(listProjectFolderTree).not.toHaveBeenCalled()
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('filing into a folder the commissioning person may only read (ADR-0088)', () => {
  const file = () =>
    fileGeneratedDocument({
      session: SESSION,
      projectId: 'proj-1',
      producer: 'agent_document',
      ref: 'ref-read-only',
      title: 'Bericht',
      render,
    })

  it('refuses a read-only Berichte with a typed 403 before anything is rendered or written', async () => {
    vi.mocked(requireFolderWrite).mockRejectedValueOnce(folderReadOnlyError())

    await expect(file()).rejects.toBeInstanceOf(ForbiddenError)
    expect(requireFolderWrite).toHaveBeenCalledWith(SESSION, 'proj-1', [FOLDER.id])
    expect(render).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('asks again for a Berichte created (or raced) after the first check', async () => {
    findRootProjectFolderByName.mockResolvedValue(null)
    await file()
    expect(requireFolderWrite).toHaveBeenNthCalledWith(1, SESSION, 'proj-1', [null])
    expect(requireFolderWrite).toHaveBeenNthCalledWith(2, SESSION, 'proj-1', [FOLDER.id])
  })
})

describe('every path that can create a machine-authored row', () => {
  const modules: { path: string; code: string }[] = srcEntries()
    .filter((entry) => /\.tsx?$/.test(entry))
    .filter((entry) => !/\.(spec|test)\.tsx?$/.test(entry))
    .filter((entry) => !entry.includes('test-utils') && !entry.startsWith('app/dev'))
    .map((entry) => ({
      path: entry.split('\\').join('/'),
      code: readFileSync(srcPath(entry), 'utf8'),
    }))

  const importersOf = (specifier: string): string[] =>
    modules
      .filter(({ code }) => code.includes(`from '${specifier}'`))
      .map(({ path }) => path)
      .sort()

  it('inserts a documents row in exactly one module', () => {
    const inserters = modules
      .filter(({ code }) => /\.insert\(\s*documents\s*\)/.test(code))
      .map(({ path }) => path)
    expect(inserters).toEqual(['lib/storage/repository.ts'])
  })

  it('reaches that insert only through the one admitting path', () => {
    expect(importersOf('./service').filter((path) => path.startsWith('lib/storage/'))).toContain(
      'lib/storage/admission.ts',
    )
    const direct = modules
      .filter(({ path }) => path !== 'lib/storage/admission.ts' && path !== 'lib/storage/service.ts')
      .filter(({ code }) => code.includes('admitDocumentWithinQuota'))
      .map(({ path }) => path)
    expect(direct).toEqual([])
  })

  const admissionCalls = (code: string): string[] => {
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const needle = 'admitOrDiscard('
    const calls: string[] = []
    for (let from = 0; ; ) {
      const start = stripped.indexOf(needle, from)
      if (start === -1) return calls
      let depth = 0
      let index = start + needle.length - 1
      for (; index < stripped.length; index++) {
        if (stripped[index] === '(') depth++
        else if (stripped[index] === ')' && --depth === 0) break
      }
      calls.push(stripped.slice(start, index + 1))
      from = index + 1
    }
  }

  it('has exactly three callers of the admitting path, and only this one authors a row', () => {
    const admitters = importersOf('@/lib/storage/admission')
    expect(admitters).toEqual([
      'lib/documents/generated.ts',
      'lib/documents/shelf-upload.ts',
      'lib/session-documents/service.ts',
    ])

    const authoring = admitters.filter((path) =>
      admissionCalls(modules.find((module) => module.path === path)!.code).some((call) =>
        call.includes('authoredBy'),
      ),
    )
    expect(authoring).toEqual(['lib/documents/generated.ts'])
  })

  it('never lets an UPDATE change the author of a row that already exists', () => {
    const promoting: string[] = []
    for (const { path, code } of modules) {
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (let from = 0; ; ) {
        const start = stripped.indexOf('.update(documents)', from)
        if (start === -1) break
        const end = stripped.indexOf('.where(', start)
        const payload = stripped.slice(start, end === -1 ? start + 400 : end)
        if (payload.includes('authoredBy')) promoting.push(path)
        from = start + 1
      }
    }
    expect(promoting).toEqual([])
  })

  it('gates that one module on both permissions and the flag', () => {
    const code = modules.find((module) => module.path === 'lib/documents/generated.ts')!.code
    expect(code).toContain("'project:documents:write'")
    expect(code).toContain("'project:documents:generate'")
    expect(code).toContain('isAgentAuthoredDocumentsEnabled(session)')
  })
})

describe('resolveGeneratedDocumentDestination', () => {
  it('returns the fixed Berichte folder for every producer there is', () => {
    for (const producer of GENERATED_DOCUMENT_PRODUCERS) {
      expect(resolveGeneratedDocumentDestination(producer)).toEqual({ folderName: 'Berichte' })
    }
  })
})

describe('generatedFilename', () => {
  const day = new Date('2026-08-20T11:00:00Z')

  it('spells the umlauts rather than stripping them, and keeps a foreign name whole', () => {
    expect(generatedFilename('Fluchtweglängen Gebäudeklasse 4', 'application/pdf', day)).toBe(
      'fluchtweglaengen-gebaeudeklasse-4-2026-08-20.pdf',
    )
    expect(generatedFilename('Gutachten Łódź', 'application/pdf', day)).toBe(
      'gutachten-lodz-2026-08-20.pdf',
    )
  })

  it('transliterates a German title into an ASCII stem with the date', () => {
    expect(generatedFilename('Brandschutz Straßenhäuser', 'application/pdf', day)).toBe(
      'brandschutz-strassenhaeuser-2026-08-20.pdf',
    )
  })

  it('picks the extension from the content type', () => {
    expect(
      generatedFilename(
        'Bericht',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        day,
      ),
    ).toBe('bericht-2026-08-20.docx')
  })

  it('says so rather than lying about a type it does not know', () => {
    expect(generatedFilename('Bericht', 'application/x-unknown', day)).toBe('bericht-2026-08-20.bin')
  })

  it('never emits an empty stem', () => {
    expect(generatedFilename('   ***   ', 'application/pdf', day)).toBe('document-2026-08-20.pdf')
  })
})

describe('the audit event this feature depends on', () => {
  it('emits only metadata keys the registry declares', async () => {
    await file()

    const [event] = recordAuditEventOrThrow.mock.calls[0] as [
      { action: keyof typeof AUDIT_SCHEMAS; metadata?: Record<string, unknown> },
    ]
    const schema = AUDIT_SCHEMAS[event.action]
    const registered = 'metadata' in schema ? Object.keys(schema.metadata) : []

    expect(Object.keys(event.metadata ?? {}).length).toBeGreaterThan(0)
    for (const key of Object.keys(event.metadata ?? {})) {
      expect(registered).toContain(key)
    }
  })
})

describe('taking a document back when its audit write fails', () => {
  it('leaves the object alone when the ROW delete fails, so the document still opens', async () => {
    recordAuditEventOrThrow.mockRejectedValueOnce(new Error('audit rejected'))
    deleteProjectDocument.mockRejectedValueOnce(new Error('row delete failed'))

    await expect(file()).rejects.toThrow('audit rejected')

    const deletes = s3Send.mock.calls.filter(
      ([command]) => (command as { constructor: { name: string } }).constructor.name === 'DeleteObjectCommand',
    )
    expect(deletes).toHaveLength(0)
  })

  it('takes the object back once the row is known to be gone', async () => {
    recordAuditEventOrThrow.mockRejectedValueOnce(new Error('audit rejected'))

    await expect(file()).rejects.toThrow('audit rejected')

    const deletes = s3Send.mock.calls.filter(
      ([command]) => (command as { constructor: { name: string } }).constructor.name === 'DeleteObjectCommand',
    )
    expect(deletes).toHaveLength(1)
  })

  it('never turns a failure of its own into the error the caller sees', async () => {
    recordAuditEventOrThrow.mockRejectedValueOnce(new Error('audit rejected'))
    deleteProjectDocument.mockRejectedValueOnce(new Error('row delete failed'))

    await expect(file()).rejects.toThrow('audit rejected')
  })
})

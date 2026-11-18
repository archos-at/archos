/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { AUDIT_SCHEMAS } from '@/lib/audit/schemas.mjs'
import type { NewDocument } from '@/lib/db/schema/documents'
import { makeProject } from '@/test-utils/db-fixtures'
import { GENERATED_DOCUMENT_PRODUCER_REF_KINDS, fileGeneratedDocument } from './generated'
import { FOLDER, filingInput, render, sentCommands } from './generated.fixtures'

const {
  s3Send,
  ensureTenantBucketChecked,
  admitOrDiscard,
  requireProjectAccess,
  recordAuditEventOrThrow,
  findProjectInOrg,
  getOrCreateProjectFolderByName,
  findRootProjectFolderByName,
  findDocumentAuthoredByRef,
  deleteProjectDocument,
} = vi.hoisted(() => ({
  s3Send: vi.fn(),
  ensureTenantBucketChecked: vi.fn(),
  admitOrDiscard: vi.fn(),
  requireProjectAccess: vi.fn(),
  recordAuditEventOrThrow: vi.fn(),
  findProjectInOrg: vi.fn(),
  getOrCreateProjectFolderByName: vi.fn(),
  findRootProjectFolderByName: vi.fn(),
  findDocumentAuthoredByRef: vi.fn(),
  deleteProjectDocument: vi.fn(),
}))

vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/s3', () => ({
  s3Client: { send: s3Send },
  bucketAdminS3Client: {},
  buildStorageKey: (
    organizationId: string,
    projectId: string,
    documentId: string,
    filename: string,
    folderPath?: string | null,
  ) => `org/${organizationId}/project/${projectId}/${folderPath ?? ''}/doc/${documentId}/${filename}`,
}))
vi.mock('@/lib/storage/bucket', () => ({ ensureTenantBucketChecked }))
vi.mock('@/lib/storage/admission', () => ({ admitOrDiscard }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEventOrThrow }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg }))
vi.mock('@/lib/projects/folder-service', () => ({ getOrCreateProjectFolderByName, findRootProjectFolderByName }))
vi.mock('@/lib/conversations/restricted-use', () => ({
  recordedRestrictedFolders: vi.fn(async () => []),
  recordedSourceProjects: async () => [],
}))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn(async () => []) }))
vi.mock('./repository', () => ({ findDocumentAuthoredByRef, deleteProjectDocument }))

const file = () => fileGeneratedDocument(filingInput())

const admittedRow = (): NewDocument => admitOrDiscard.mock.calls[0][2] as NewDocument

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectAccess.mockResolvedValue({ role: 'editor' })
  findDocumentAuthoredByRef.mockResolvedValue(null)
  findProjectInOrg.mockResolvedValue(makeProject({ id: 'proj-1', collectionName: 'proj_abc' }))
  getOrCreateProjectFolderByName.mockResolvedValue(FOLDER)
  findRootProjectFolderByName.mockResolvedValue(FOLDER)
  ensureTenantBucketChecked.mockResolvedValue('grid-org-org-1')
  s3Send.mockResolvedValue({})
  admitOrDiscard.mockResolvedValue(undefined)
  recordAuditEventOrThrow.mockResolvedValue(undefined)
  deleteProjectDocument.mockResolvedValue(undefined)
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

      const puts = sentCommands(s3Send, PutObjectCommand)
      const deletes = sentCommands(s3Send, DeleteObjectCommand)
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
      await fileGeneratedDocument(filingInput({ producer: 'diagram_pdf', ref: 'run_7', title: 'Ablauf' }))
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

    it('does not tell an auditor a diagram’s reference is a job id', async () => {
      await fileGeneratedDocument(filingInput({ producer: 'diagram_svg', ref: 'msg_42-1a2b3c4d', title: 'Ablauf' }))

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

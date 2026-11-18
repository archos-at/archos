/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { InsufficientStorageError, NotFoundError } from '@/lib/api/errors'
import { aiProvenanceMarking } from '@/lib/ai-provenance'
import { PRODUCT_NAME } from '@/lib/brand'
import type { NewDocument } from '@/lib/db/schema/documents'
import { makeProject } from '@/test-utils/db-fixtures'
import {
  GENERATED_DOCUMENT_PRODUCERS,
  UnmarkedRenderingError,
  fileGeneratedDocument,
  generatedDocumentMarking,
  generatedFilename,
  resolveGeneratedDocumentDestination,
} from './generated'
import { FOLDER, REPORT_MARKING, SESSION, filingInput, render, renderedBytes, sentCommands } from './generated.fixtures'

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
  dispatchDocument,
  dispatchIngest,
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
  dispatchDocument: vi.fn(),
  dispatchIngest: vi.fn(),
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
vi.mock('@/lib/documents/document-dispatch', () => ({ dispatchDocument }))
vi.mock('@/lib/documents/ingest-dispatch', () => ({ dispatchIngest }))

const file = () => fileGeneratedDocument(filingInput())

const admittedRow = (): NewDocument => admitOrDiscard.mock.calls[0][2] as NewDocument

const onlyPut = (): PutObjectCommand => {
  const puts = sentCommands(s3Send, PutObjectCommand)
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

      it('files a publishable agent document under piloti/<document id>/', async () => {
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

    it('makes no ingest dispatch and no HTTP request when the audit write undoes the filing', async () => {
      recordAuditEventOrThrow.mockRejectedValueOnce(new Error('audit rejected'))

      await expect(file()).rejects.toThrow('audit rejected')

      expect(dispatchDocument).not.toHaveBeenCalled()
      expect(dispatchIngest).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
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

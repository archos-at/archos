/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PutObjectCommand } from '@aws-sdk/client-s3'

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
  ) => `org/${organizationId}/project/${projectId}/doc/${documentId}/${filename}`,
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
vi.mock('@/lib/projects/folder-service', () => ({
  getOrCreateProjectFolderByName: (...args: unknown[]) => getOrCreateProjectFolderByName(...args),
  findRootProjectFolderByName: vi.fn(async () => null),
}))

const recordedRestrictedFolders = vi.fn(async (): Promise<string[]> => [])
vi.mock('@/lib/conversations/restricted-use', () => ({
  recordedRestrictedFolders: (...args: unknown[]) => recordedRestrictedFolders(...(args as [])),
  recordedSourceProjects: async () => [],
}))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn(async () => []) }))

const findDocumentAuthoredByRef = vi.fn()
const deleteProjectDocument = vi.fn()
vi.mock('@/lib/documents/repository', () => ({
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

import type { NewDocument } from '@/lib/db/schema/documents'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeProject } from '@/test-utils/db-fixtures'
import { generatedDocumentMarking } from '@/lib/documents/generated'
import { fileDiagramDocuments } from './filing'
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

const SOURCE = 'graph TD\n  Einreichung --> Bauverhandlung --> Baubewilligung'
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90">' +
  '<rect x="10" y="10" width="80" height="40" fill="#eef" stroke="#334"/>' +
  '<text x="20" y="35" font-size="11" fill="#111">Einreichung</text>' +
  '</svg>'

const file = (overrides: Partial<Parameters<typeof fileDiagramDocuments>[0]> = {}) =>
  fileDiagramDocuments({
    session: SESSION,
    projectId: 'proj-1',
    answerRef: 'msg_42-1a2b3c4d',
    title: 'Ablauf Einreichung',
    sourceKind: 'mermaid',
    source: SOURCE,
    svg: SVG,
    marking: `Von ${PRODUCT_NAME} erstellt — KI-generiert, nicht geprüft.`,
    ...overrides,
  })

function admitted(): NewDocument[] {
  return admitOrDiscard.mock.calls.map((call) => call[2] as NewDocument)
}

beforeEach(() => {
  vi.clearAllMocks()
  let minted = 0
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `doc-${++minted}` })
  requireProjectAccess.mockResolvedValue(undefined)
  findDocumentAuthoredByRef.mockResolvedValue(null)
  findProjectInOrg.mockResolvedValue(makeProject({ id: 'proj-1', name: 'Straßenhäuser' }))
  getOrCreateProjectFolderByName.mockResolvedValue({
    id: 'folder-1',
    projectId: 'proj-1',
    parentId: null,
    name: 'Berichte',
    path: 'Berichte',
    createdAt: new Date('2026-08-20T00:00:00Z'),
    updatedAt: new Date('2026-08-20T00:00:00Z'),
  })
  ensureTenantBucketChecked.mockResolvedValue('bucket-org-1')
  s3Send.mockResolvedValue({})
  admitOrDiscard.mockResolvedValue(undefined)
  recordAuditEventOrThrow.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('a diagram is two files', () => {
  it('files an SVG and a PDF, as two rows of two producers', async () => {
    const filed = await file()
    const { pdf } = filed
    if (!pdf) throw new Error('expected both halves to be filed')

    expect(admitted().map((row) => row.authoredByProducer)).toEqual(['diagram_svg', 'diagram_pdf'])
    expect(admitted().map((row) => row.contentType)).toEqual(['image/svg+xml', 'application/pdf'])
    expect(filed.svg.documentId).not.toBe(pdf.documentId)
  })

  it('gives both rows the same run, which is what makes them one diagram', async () => {
    await file()
    expect(admitted().map((row) => row.authoredByRef)).toEqual(['msg_42-1a2b3c4d', 'msg_42-1a2b3c4d'])
    expect(admitted().map((row) => row.authoredByRefKind)).toEqual(['answer_artifact', 'answer_artifact'])
    expect(findDocumentAuthoredByRef.mock.calls.map((call) => call[3])).toEqual([
      'diagram_svg',
      'diagram_pdf',
    ])
  })

  it('names both files after the diagram, with the extension telling them apart', async () => {
    await file()
    expect(admitted().map((row) => row.filename)).toEqual([
      expect.stringMatching(/^ablauf-einreichung-\d{4}-\d{2}-\d{2}\.svg$/),
      expect.stringMatching(/^ablauf-einreichung-\d{4}-\d{2}-\d{2}\.pdf$/),
    ])
  })
})

describe('every rule of the existing feature still applies', () => {
  it('marks both rows as written by a machine, on the commissioning human', async () => {
    await file()
    for (const row of admitted()) {
      expect(row.authoredBy).toBe('agent')
      expect(row.createdBy).toBe('user-1')
    }
  })

  it('leaves both rows at `stored`, never at pending', async () => {
    await file()
    expect(admitted().map((row) => row.status)).toEqual(['stored', 'stored'])
  })

  it('files both into the project, with zero assignees implied by the row', async () => {
    await file()
    for (const row of admitted()) {
      expect(row.projectId).toBe('proj-1')
      expect(row.folderId).toBe('folder-1')
    }
    expect(admitOrDiscard.mock.calls.some((call) => 'assignees' in (call[2] as object))).toBe(false)
  })

  it('never dispatches either file to the index', async () => {
    await file()
    expect(dispatchDocument).not.toHaveBeenCalled()
    expect(dispatchIngest).not.toHaveBeenCalled()
  })

  it('asks for the write permission before storing a byte', async () => {
    requireProjectAccess.mockRejectedValueOnce(new Error('forbidden'))
    await expect(file()).rejects.toThrow('forbidden')
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('records an audit event per filed row', async () => {
    await file()
    expect(recordAuditEventOrThrow).toHaveBeenCalledTimes(2)
    expect(
      recordAuditEventOrThrow.mock.calls.map((call) => call[0].metadata.producer),
    ).toEqual(['diagram_svg', 'diagram_pdf'])
  })
})

describe('what is stored is not what was sent', () => {
  it('stores the SVG this codebase wrote, from its allow-list', async () => {
    await file({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<rect width="10" height="10" fill="#eee" data-sneaky="x"/></svg>',
    })
    const body = s3Send.mock.calls[0][0] as PutObjectCommand
    const stored = Buffer.from(body.input.Body as Uint8Array).toString('utf8')
    expect(stored).toContain('fill="#eee"')
    expect(stored).not.toContain('data-sneaky')
  })

  it('puts the diagram source inside the stored SVG', async () => {
    await file()
    const body = s3Send.mock.calls[0][0] as PutObjectCommand
    const stored = Buffer.from(body.input.Body as Uint8Array).toString('utf8')
    expect(stored).toContain('<metadata data-diagram-source="mermaid">')
    expect(stored).toContain('Bauverhandlung')
  })

  it('refuses the whole submission before anything is authorized or stored', async () => {
    await expect(
      file({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>x()</script></svg>' }),
    ).rejects.toThrow(/script-element/)
    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('refuses a deeply nested diagram by name, not by exhausting the stack', async () => {
    const deep = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<g>'.repeat(5000)}<rect width="1" height="1"/>${'</g>'.repeat(5000)}</svg>`

    await expect(file({ svg: deep })).rejects.toThrow(/too-deep/)
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })
})

describe('what leaves the product says a machine made it', () => {
  const storedBytes = (index: number): Uint8Array => {
    const command = s3Send.mock.calls[index][0] as PutObjectCommand
    return command.input.Body as Uint8Array
  }

  const EXPECTED_MARKING = `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`

  it('puts the marking in the stored SVG, past the allow-list that rewrites it', async () => {
    await file()
    const stored = Buffer.from(storedBytes(0)).toString('utf8')

    expect(stored).toContain(
      `<title>Von ${PRODUCT_NAME} erstellt — KI-generiert, nicht geprüft.</title>`,
    )
    expect(stored).toContain(`<desc>${EXPECTED_MARKING}</desc>`)
    expect(stored).toContain('Einreichung')
  })

  it('puts the marking in the stored PDF, where a records system reads it', async () => {
    await file()
    const stored = Buffer.from(storedBytes(1)).toString('latin1')

    expect(stored.slice(0, 5)).toBe('%PDF-')
    expect(stored).toContain(EXPECTED_MARKING)
    expect(stored).toContain(PRODUCT_NAME)
  })

  it('does not claim a diagram was drawn in a run that does not exist', async () => {
    await file()

    expect(Buffer.from(storedBytes(0)).toString('utf8')).not.toContain('AIRunId')
    expect(Buffer.from(storedBytes(1)).toString('latin1')).not.toContain('AIRunId')
  })

  it('writes the marking the seam is going to check for, not one of its own', async () => {
    await file()

    expect(s3Send).toHaveBeenCalledTimes(2)
    expect(Buffer.from(storedBytes(0)).toString('utf8')).toContain(
      `<desc>${generatedDocumentMarking('diagram_svg', 'msg_42-1a2b3c4d')}</desc>`,
    )
  })
})

describe('a partial filing is recoverable rather than rolled back', () => {
  it('keeps the SVG when the PDF cannot be filed, and says so in the result', async () => {
    admitOrDiscard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const filed = await file()

    expect(filed.svg.documentId).toBeTruthy()
    expect(filed.pdf).toBeNull()
    expect(admitted().map((row) => row.authoredByProducer)).toEqual(['diagram_svg', 'diagram_pdf'])
  })

  it('leaves the operator the reason it does not put in front of the reader', async () => {
    admitOrDiscard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await file()

    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('the SVG was filed and the PDF was not'),
      expect.objectContaining({ answerRef: 'msg_42-1a2b3c4d', cause: expect.stringContaining('quota') }),
    )
  })

  it('still throws when the SVG itself cannot be filed, because there is no half to report', async () => {
    admitOrDiscard.mockRejectedValueOnce(new Error('quota'))
    await expect(file()).rejects.toThrow('quota')
  })

  it('files only the missing half on a retry', async () => {
    findDocumentAuthoredByRef.mockImplementation((_ref: string, _org: string, _project: string, producer: string) =>
      producer === 'diagram_svg'
        ? Promise.resolve({ id: 'doc-svg', filename: 'ablauf.svg', folderId: 'folder-1' })
        : Promise.resolve(null),
    )
    const filed = await file()
    const { pdf } = filed
    if (!pdf) throw new Error('expected the retry to file the missing half')
    expect(filed.svg.alreadyFiled).toBe(true)
    expect(pdf.alreadyFiled).toBe(false)
    expect(admitted().map((row) => row.authoredByProducer)).toEqual(['diagram_pdf'])
  })
})

describe('a diagram drawn in a conversation that drew on a restricted folder (ADR-0087, ADR-0088)', () => {
  it('files neither half into an open folder', async () => {
    const { ConversationConfinedError } = await import('@/lib/api/errors')
    recordedRestrictedFolders.mockResolvedValue(['folder-vertraege'])

    await expect(file({ origin: { conversationId: 's_conv_1', locale: 'de' } })).rejects.toBeInstanceOf(
      ConversationConfinedError,
    )
    expect(recordedRestrictedFolders).toHaveBeenCalledWith('s_conv_1', 'org-1')
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
  })
})

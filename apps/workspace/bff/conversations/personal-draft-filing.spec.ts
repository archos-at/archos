/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { DocumentNameMatchRow } from '@/lib/documents/repository'

vi.mock('@/lib/conversations/restricted-egress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/restricted-egress')>()),
  requireMayFileFrom: vi.fn(),
}))
vi.mock('@/lib/personal-shelf/service', () => ({
  probePersonalShelfDocumentNames: vi.fn(),
  uploadToPersonalShelf: vi.fn(),
}))
vi.mock('@/lib/personal-shelf/repository', () => ({ findPersonalShelfDocument: vi.fn() }))
vi.mock('@/lib/documents/version-repository', () => ({ findOpenVersion: vi.fn(), findPublishedVersion: vi.fn() }))
vi.mock('@/lib/documents/shelf-folders', () => ({ findShelfFolder: vi.fn() }))
vi.mock('@/lib/organizations/service', () => ({ getOrganizationDisplayName: vi.fn().mockResolvedValue('Büro') }))
vi.mock('@/lib/documents/branding', () => ({
  resolveDocumentBranding: vi.fn().mockResolvedValue({
    productName: 'Product',
    tagline: 't',
    prose: 'p',
    disclaimer: 'd',
    footerLine: 'f',
    headerLine: 'h',
    aiDisclosure: 'KI-Entwurf',
    aiGeneratorName: 'Generator',
  }),
}))
vi.mock('./draft-refiling', () => ({
  readDraftWork: vi.fn().mockResolvedValue({ kind: 'markdown', content: '# Aktenvermerk' }),
  recordFiling: vi.fn(),
}))

import { requireMayFileFrom } from '@/lib/conversations/restricted-egress'
import { findOpenVersion } from '@/lib/documents/version-repository'
import { findPersonalShelfDocument } from '@/lib/personal-shelf/repository'
import { probePersonalShelfDocumentNames, uploadToPersonalShelf } from '@/lib/personal-shelf/service'
import { filingName } from './draft-filing'
import { draftFileType } from './draft-media'
import type { DraftFacts } from './draft-preview'
import { recordFiling } from './draft-refiling'
import { fileDraftToPersonalShelf, type PersonalFilingContext } from './personal-draft-filing'

const SESSION = { userId: 'user_1', organizationId: 'org_1', email: 'u@example.test' } as AuthorizedSession
const PATH = 'entwuerfe/aktenvermerk.md'

const context = (facts: Partial<DraftFacts> = {}): PersonalFilingContext => ({
  session: SESSION,
  conversationId: 'conv-1',
  path: PATH,
  type: draftFileType(PATH),
  facts: { version: 2, filing: null, derivedFrom: null, ...facts } as DraftFacts,
  request: new Request('https://example.test/api'),
  locale: 'de',
})

const uploadedFile = (): File => vi.mocked(uploadToPersonalShelf).mock.calls[0][1]

describe('fileDraftToPersonalShelf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(probePersonalShelfDocumentNames).mockResolvedValue([])
    vi.mocked(findPersonalShelfDocument).mockResolvedValue(null)
    vi.mocked(uploadToPersonalShelf).mockResolvedValue({ documentId: 'doc-1', jobId: null, status: 'uploaded', filename: 'x' })
    vi.mocked(findOpenVersion).mockResolvedValue({ id: 'ver-1', state: 'draft', versionNumber: 1 } as DocumentVersion)
  })

  it('saves a new draft into the asker’s own shelf, marked as AI work, and records the filing', async () => {
    const filed = await fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk' }, 'ref-1', filingName)

    expect(requireMayFileFrom).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
      expect.objectContaining({ projectId: null, projectCollection: expect.stringContaining('personal_') }),
    )
    expect(uploadedFile().name).toBe('Aktenvermerk.md')
    expect(await uploadedFile().text()).toContain('KI-Entwurf')
    expect(vi.mocked(uploadToPersonalShelf).mock.calls[0][3]).toMatchObject({ folderId: null, originConversationId: 'conv-1' })
    expect(recordFiling).toHaveBeenCalledWith(expect.anything(), 'doc-1', expect.objectContaining({ id: 'ver-1' }))
    expect(filed).toMatchObject({ documentId: 'doc-1', versionId: 'ver-1', outcome: 'filed', folderName: null })
  })

  it('answers same-name instead of replacing a file the person already keeps under that name', async () => {
    vi.mocked(probePersonalShelfDocumentNames).mockResolvedValue([
      { id: 'mine', filename: 'Aktenvermerk.md' } as DocumentNameMatchRow,
    ])

    const filing = fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk' }, 'ref-1', filingName)

    await expect(filing).rejects.toBeInstanceOf(ConflictError)
    await expect(filing).rejects.toMatchObject({ details: { reason: 'same-name', documentId: 'mine' } })
    expect(uploadToPersonalShelf).not.toHaveBeenCalled()
  })

  it('files under its own name beside a file of that name in another folder: it is another document', async () => {
    vi.mocked(probePersonalShelfDocumentNames).mockResolvedValue([
      { id: 'elsewhere', filename: 'aktenvermerk.md', folderId: 'folder-archiv' } as DocumentNameMatchRow,
    ])

    await fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk' }, 'ref-1', filingName)

    expect(uploadedFile().name).toBe('Aktenvermerk.md')
  })

  it('numbers past a name the folder holds in another case', async () => {
    vi.mocked(probePersonalShelfDocumentNames).mockResolvedValue([
      { id: 'mine', filename: 'AKTENVERMERK.md' } as DocumentNameMatchRow,
    ])

    await fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk', force: true }, 'ref-1', filingName)

    expect(uploadedFile().name).toBe('Aktenvermerk (2).md')
  })

  it('saves under the next free name when the person files anyway', async () => {
    vi.mocked(probePersonalShelfDocumentNames).mockResolvedValue([
      { id: 'mine', filename: 'Aktenvermerk.md' } as DocumentNameMatchRow,
      { id: 'mine-2', filename: 'Aktenvermerk (2).md' } as DocumentNameMatchRow,
    ])

    await fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk', force: true }, 'ref-1', filingName)

    expect(uploadedFile().name).toBe('Aktenvermerk (3).md')
  })

  it('updates the file it saved before, where the person keeps it now', async () => {
    vi.mocked(findPersonalShelfDocument).mockResolvedValue({
      id: 'doc-1',
      filename: 'Umbenannt.md',
      folderId: 'folder-9',
    } as never)
    const filing = { documentId: 'doc-1', versionId: 'v0', contentHash: 'h', state: 'draft', filedAtVersion: 1, kind: '' as const }

    const filed = await fileDraftToPersonalShelf(context({ filing }), { path: PATH, title: 'Aktenvermerk' }, 'ref-1', filingName)

    expect(probePersonalShelfDocumentNames).not.toHaveBeenCalled()
    expect(uploadedFile().name).toBe('Umbenannt.md')
    expect(vi.mocked(uploadToPersonalShelf).mock.calls[0][3]).toMatchObject({ folderId: 'folder-9' })
    expect(filed.outcome).toBe('updated')
  })

  it('writes nothing when the draft has not changed since it was saved', async () => {
    vi.mocked(findPersonalShelfDocument).mockResolvedValue({ id: 'doc-1', filename: 'A.md', folderId: null } as never)
    const filing = { documentId: 'doc-1', versionId: 'v0', contentHash: 'h', state: 'draft', filedAtVersion: 2, kind: '' as const }

    const filed = await fileDraftToPersonalShelf(context({ filing }), { path: PATH, title: 'A' }, 'ref-1', filingName)

    expect(uploadToPersonalShelf).not.toHaveBeenCalled()
    expect(recordFiling).not.toHaveBeenCalled()
    expect(filed.outcome).toBe('unchanged')
  })

  it('writes nothing when the chat may not file into the asker’s shelf', async () => {
    vi.mocked(requireMayFileFrom).mockRejectedValueOnce(new ConflictError('confined'))

    await expect(
      fileDraftToPersonalShelf(context(), { path: PATH, title: 'Aktenvermerk' }, 'ref-1', filingName),
    ).rejects.toThrow('confined')
    expect(uploadToPersonalShelf).not.toHaveBeenCalled()
  })
})

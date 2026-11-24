/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./lifecycle', () => ({ replaceVersionFile: vi.fn(), transitionDocumentVersion: vi.fn() }))
vi.mock('./revision', () => ({ openDraftForRevision: vi.fn() }))
vi.mock('./version-repository', () => ({
  findOpenVersion: vi.fn(),
  findPublishedVersion: vi.fn(),
  MAX_CHANGE_NOTE_CHARS: 500,
}))

import { ConflictError } from '@/lib/api/errors'
import { markingIsInBytes } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeDocument } from '@/test-utils/db-fixtures'
import { getAccessibleDocument } from './access'
import { renderRevisionFile, reviseWithAgentWork, type ReviseWithAgentWorkInput } from './agent-file-revision'
import { DOCX, ooxml } from './agent-file.fixtures'
import { generatedDocumentMarking } from './generated'
import { replaceVersionFile, transitionDocumentVersion } from './lifecycle'
import { openDraftForRevision } from './revision'
import { version } from './version-content.fixtures'
import { findOpenVersion, findPublishedVersion } from './version-repository'

const session = { userId: 'user_1', organizationId: 'org_1', email: 'a@example.test' } as AuthorizedSession

const filed = makeDocument({
  id: 'doc_1',
  projectId: 'proj_1',
  authoredBy: 'agent',
  authoredByProducer: 'agent_file',
  authoredByRef: 'conv_1-raumbuch',
  contentType: DOCX,
})

const uploaded = makeDocument({ id: 'doc_up', projectId: 'proj_1', authoredBy: 'user', contentType: DOCX })

const work = { kind: 'file' as const, file: { contentType: DOCX, bytes: ooxml() } }

const options = { request: undefined, actingHuman: false }

const revise = (input: Partial<ReviseWithAgentWorkInput> = {}) =>
  reviseWithAgentWork(session, { documentId: 'doc_1', projectId: 'proj_1', work, options, ...input })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(filed)
  vi.mocked(findOpenVersion).mockResolvedValue(null)
  vi.mocked(findPublishedVersion).mockResolvedValue(null)
  vi.mocked(replaceVersionFile).mockImplementation(async (_session, _id, versionId) =>
    version({ id: versionId, versionNumber: 3, contentType: DOCX }),
  )
  vi.mocked(transitionDocumentVersion).mockImplementation(async (_session, _id, versionId) =>
    version({ id: versionId, versionNumber: 3, state: 'published', contentType: DOCX }),
  )
})

describe('reviseWithAgentWork', () => {
  it('writes into its own open draft when the filed bytes are still the ones in the project', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_open', state: 'draft', contentHash: 'sha256:filed', contentType: DOCX }))

    const revised = await revise({ ifMatch: 'sha256:filed', ownVersionId: 'ver_open' })

    expect(revised.forked).toBe(false)
    expect(vi.mocked(replaceVersionFile).mock.calls[0][2]).toBe('ver_open')
    expect(openDraftForRevision).not.toHaveBeenCalled()
  })

  it('makes the next Fassung of an approved or published document instead of refusing', async () => {
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ id: 'ver_pub', state: 'published', contentHash: 'sha256:filed', contentType: DOCX }))
    vi.mocked(openDraftForRevision).mockResolvedValue({
      version: version({ id: 'ver_fork', state: 'draft', contentHash: 'sha256:filed' }),
      filename: 'Raumbuch.xlsx',
      reviewers: [],
    })

    const revised = await revise({ ifMatch: 'sha256:filed' })

    expect(revised.forked).toBe(true)
    expect(vi.mocked(replaceVersionFile).mock.calls[0][2]).toBe('ver_fork')
  })

  it('publishes the Fassung it wrote, because the person who files it signs it off', async () => {
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ id: 'ver_pub', state: 'published', contentHash: 'sha256:filed', contentType: DOCX }))
    vi.mocked(openDraftForRevision).mockResolvedValue({
      version: version({ id: 'ver_fork', state: 'draft', contentHash: 'sha256:filed' }),
      filename: 'Raumbuch.xlsx',
      reviewers: [],
    })

    const revised = await revise({ ifMatch: 'sha256:filed' })

    expect(transitionDocumentVersion).toHaveBeenCalledWith(session, 'doc_1', 'ver_fork', 'file', {
      request: undefined,
      actingHuman: false,
    })
    expect(revised.version).toMatchObject({ id: 'ver_fork', state: 'published' })
  })

  it('refuses when a person changed the bytes, and writes over them only when a person said so', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(
      version({ id: 'ver_open', state: 'draft', contentHash: 'sha256:person', versionNumber: 2, contentType: DOCX }),
    )

    await expect(revise({ ifMatch: 'sha256:filed', ownVersionId: 'ver_open' })).rejects.toMatchObject({
      details: { reason: 'changed-in-project', versionNumber: 2 },
    })
    expect(replaceVersionFile).not.toHaveBeenCalled()

    await revise({ ifMatch: 'sha256:filed', ownVersionId: 'ver_open', overChanges: true })
    expect(vi.mocked(replaceVersionFile).mock.calls[0][3]).toBe('sha256:person')
  })

  it('never writes into a person’s open draft or changes_requested version, even with the same hash', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    for (const state of ['draft', 'changes_requested'] as const) {
      vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_person', state, contentHash: 'sha256:read' }))
      await expect(revise({ documentId: 'doc_up', ifMatch: 'sha256:read' })).rejects.toMatchObject({
        details: { reason: 'changed-in-project' },
      })
    }
    expect(replaceVersionFile).not.toHaveBeenCalled()
  })

  it('refuses a document in review', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ state: 'in_review' }))
    await expect(revise()).rejects.toMatchObject({ details: { reason: 'in-review' } })
  })

  it('refuses a document of another project', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...uploaded, projectId: 'proj_2' })
    await expect(revise({ documentId: 'doc_up' })).rejects.toMatchObject({ status: 422, details: { reason: 'other-project' } })
  })

  it('refuses a Markdown draft as a Fassung of a person’s document', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    await expect(revise({ documentId: 'doc_up', work: { kind: 'markdown', content: '# x' } })).rejects.toMatchObject({
      status: 422,
    })
  })

  it('writes the Änderungsvermerk with the bytes, and clears an old one when none is given', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_open', state: 'draft', contentType: DOCX }))

    await revise({ ownVersionId: 'ver_open', changeNote: ' Fläche Raum 2.04 korrigiert ' })
    await revise({ ownVersionId: 'ver_open' })

    expect(vi.mocked(replaceVersionFile).mock.calls[0][4]).toMatchObject({
      versionFields: { changeNote: 'Fläche Raum 2.04 korrigiert' },
    })
    expect(vi.mocked(replaceVersionFile).mock.calls[1][4]).toMatchObject({ versionFields: { changeNote: null } })
  })

  it('writes nothing when the bytes are the ones already in the project', async () => {
    const memo = makeDocument({ ...filed, authoredByProducer: 'agent_document', contentType: 'text/markdown' })
    vi.mocked(getAccessibleDocument).mockResolvedValue(memo)
    const { renderVersionBytes } = await import('./version-content')
    const rendered = await renderVersionBytes(memo, version({ contentType: 'text/markdown' }), '# Vermerk', { filed: true })
    vi.mocked(findOpenVersion).mockResolvedValue(
      version({ id: 'ver_open', state: 'draft', contentHash: rendered.contentHash, contentType: 'text/markdown' }),
    )

    const revised = await revise({ work: { kind: 'markdown', content: '# Vermerk' }, ownVersionId: 'ver_open', agentFiledOnly: true })

    expect(revised.unchanged).toBe(true)
    expect(replaceVersionFile).not.toHaveBeenCalled()
  })

  it('updates only a document the agent filed when the call is an update of its own filing', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    await expect(revise({ documentId: 'doc_up', agentFiledOnly: true })).rejects.toBeInstanceOf(ConflictError)
  })

  it('asks for write access to the document it revises', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    vi.mocked(openDraftForRevision).mockResolvedValue({ version: version({ id: 'ver_fork' }), filename: 'x', reviewers: [] })

    await revise({ documentId: 'doc_up' })

    expect(getAccessibleDocument).toHaveBeenCalledWith(session, 'doc_up', 'write')
  })
})

describe('renderRevisionFile', () => {
  it('marks the bytes as made by AI, also for a Fassung of a person’s document', () => {
    const rendered = renderRevisionFile(uploaded, version({ contentType: DOCX }), work.file)
    expect(markingIsInBytes(rendered.bytes, generatedDocumentMarking('agent_file', 'doc_up'))).toBe(true)
  })
})

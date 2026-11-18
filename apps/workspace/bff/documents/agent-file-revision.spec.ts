/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./lifecycle', () => ({ replaceVersionFile: vi.fn() }))
vi.mock('./revision', () => ({ openDraftForRevision: vi.fn() }))
vi.mock('./version-repository', () => ({
  findOpenVersion: vi.fn(),
  findPublishedVersion: vi.fn(),
  setVersionChangeNote: vi.fn(),
}))

import { ConflictError } from '@/lib/api/errors'
import { markingIsInBytes } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeDocument } from '@/test-utils/db-fixtures'
import { getAccessibleDocument } from './access'
import { renderRevisionFile, reviseWithAgentWork } from './agent-file-revision'
import { DOCX, ooxml } from './agent-file.fixtures'
import { generatedDocumentMarking } from './generated'
import { replaceVersionFile } from './lifecycle'
import { openDraftForRevision } from './revision'
import { version } from './version-content.fixtures'
import { findOpenVersion, findPublishedVersion, setVersionChangeNote } from './version-repository'

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(filed)
  vi.mocked(findOpenVersion).mockResolvedValue(null)
  vi.mocked(findPublishedVersion).mockResolvedValue(null)
  vi.mocked(replaceVersionFile).mockImplementation(async (_session, _id, versionId) =>
    version({ id: versionId, versionNumber: 3, contentType: DOCX }),
  )
})

describe('reviseWithAgentWork', () => {
  it('writes into the open draft when the filed bytes are still the ones in the project', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_open', state: 'draft', contentHash: 'sha256:filed' }))

    const revised = await reviseWithAgentWork(session, { documentId: 'doc_1', work, ifMatch: 'sha256:filed', options })

    expect(revised.forked).toBe(false)
    expect(vi.mocked(replaceVersionFile).mock.calls[0][2]).toBe('ver_open')
    expect(openDraftForRevision).not.toHaveBeenCalled()
  })

  it('makes the next Fassung of an approved or published document instead of refusing', async () => {
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ id: 'ver_pub', state: 'published', contentHash: 'sha256:filed' }))
    vi.mocked(openDraftForRevision).mockResolvedValue({
      version: version({ id: 'ver_fork', state: 'draft', contentHash: 'sha256:filed' }),
      filename: 'Raumbuch.xlsx',
      reviewers: [],
    })

    const revised = await reviseWithAgentWork(session, { documentId: 'doc_1', work, ifMatch: 'sha256:filed', options })

    expect(revised.forked).toBe(true)
    expect(openDraftForRevision).toHaveBeenCalledWith(session, 'doc_1')
    expect(vi.mocked(replaceVersionFile).mock.calls[0][2]).toBe('ver_fork')
  })

  it('refuses in words when a person changed the document since it was filed, and writes over it when asked', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(
      version({ id: 'ver_open', state: 'draft', contentHash: 'sha256:person', versionNumber: 2 }),
    )

    const refused = await reviseWithAgentWork(session, { documentId: 'doc_1', work, ifMatch: 'sha256:filed', options }).catch(
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(ConflictError)
    expect(refused).toMatchObject({ details: { reason: 'changed-in-project', versionNumber: 2 } })
    expect(replaceVersionFile).not.toHaveBeenCalled()

    await reviseWithAgentWork(session, { documentId: 'doc_1', work, ifMatch: 'sha256:filed', overChanges: true, options })
    expect(vi.mocked(replaceVersionFile).mock.calls[0][3]).toBe('sha256:person')
  })

  it('refuses a document in review', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ state: 'in_review' }))
    await expect(reviseWithAgentWork(session, { documentId: 'doc_1', work, options })).rejects.toMatchObject({
      details: { reason: 'in-review' },
    })
  })

  it('keeps the Änderungsvermerk on the new Fassung', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_open', state: 'draft' }))

    const revised = await reviseWithAgentWork(session, {
      documentId: 'doc_1',
      work,
      changeNote: ' Fläche Raum 2.04 korrigiert ',
      options,
    })

    expect(setVersionChangeNote).toHaveBeenCalledWith('ver_open', 'org_1', 'Fläche Raum 2.04 korrigiert')
    expect(revised.version.changeNote).toBe('Fläche Raum 2.04 korrigiert')
  })

  it('updates only a document the agent filed when the call is an update of its own filing', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    await expect(
      reviseWithAgentWork(session, { documentId: 'doc_up', work, agentFiledOnly: true, options }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('asks for write access to the document it revises', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(uploaded)
    vi.mocked(openDraftForRevision).mockResolvedValue({ version: version({ id: 'ver_fork' }), filename: 'x', reviewers: [] })

    await reviseWithAgentWork(session, { documentId: 'doc_up', work, options })

    expect(getAccessibleDocument).toHaveBeenCalledWith(session, 'doc_up', 'write')
  })
})

describe('renderRevisionFile', () => {
  it('marks the bytes as made by AI, also for a Fassung of a person’s document', () => {
    const rendered = renderRevisionFile(uploaded, version({ contentType: DOCX }), work.file)
    expect(markingIsInBytes(rendered.bytes, generatedDocumentMarking('agent_file', 'doc_up'))).toBe(true)
  })
})

/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./generated', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./generated')>()),
  fileGeneratedDocument: vi.fn(),
}))
vi.mock('./lifecycle', () => ({ createDocumentVersion: vi.fn(), replaceVersionFile: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn() }))
vi.mock('./version-repository', () => ({ findOpenVersion: vi.fn() }))

import { ConflictError } from '@/lib/api/errors'
import { markingIsInBytes } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeDocument } from '@/test-utils/db-fixtures'
import { agentFileName, fileAgentFileDraft, renderAgentFileVersion } from './agent-file'
import { AgentFileRefusedError } from './agent-file-check'
import { DOCX, ooxml, png } from './agent-file.fixtures'
import { contentDigest } from './content-digest'
import { fileGeneratedDocument, GENERATED_DOCUMENT_PRODUCER_REF_KINDS, generatedDocumentMarking, type GeneratedRendering } from './generated'
import { createDocumentVersion } from './lifecycle'
import { findDocumentInOrg } from './repository'
import { version } from './version-content.fixtures'

const session = { userId: 'user_1', organizationId: 'org_1', email: 'a@example.test' } as AuthorizedSession

const agentFile = makeDocument({
  id: 'doc_1',
  projectId: 'proj_1',
  authoredBy: 'agent',
  authoredByProducer: 'agent_file',
  authoredByRef: 'conv_1-kosten',
  authoredByRefKind: 'answer_artifact',
  contentType: DOCX,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the agent_file producer', () => {
  it('names one artifact of an answer, filed under the agent namespace like an agent document', () => {
    expect(GENERATED_DOCUMENT_PRODUCER_REF_KINDS.agent_file).toBe('answer_artifact')
  })
})

describe('agentFileName', () => {
  it('keeps the agent’s name, made safe, with the extension of its type', () => {
    expect(agentFileName('../../Kostenschätzung Haus A.DOCX', DOCX)).toBe('Kostenschaetzung-Haus-A.docx')
  })

  it('refuses an extension that does not match the type', () => {
    expect(() => agentFileName('kosten.xlsx', DOCX)).toThrow(/\.docx/)
    expect(() => agentFileName('kosten', DOCX)).toThrow(/\.docx/)
  })

  it('leaves the name to the title when the agent gives none', () => {
    expect(agentFileName(undefined, DOCX)).toBeUndefined()
  })
})

describe('fileAgentFileDraft', () => {
  it('files through the generated-document path with the bytes checked and marked', async () => {
    vi.mocked(fileGeneratedDocument).mockImplementation(async (input) => {
      const marking = generatedDocumentMarking(input.producer, input.ref)
      const rendered = (await input.render({ projectId: 'proj_1', projectName: 'Haus A', marking })) as GeneratedRendering
      expect(markingIsInBytes(rendered.bytes, marking)).toBe(true)
      expect(rendered.contentType).toBe(DOCX)
      return { documentId: 'doc_1', filename: 'x', folderId: 'f', alreadyFiled: false }
    })
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...agentFile, contentHash: null })
    vi.mocked(createDocumentVersion).mockResolvedValue(version({ id: 'ver_9' }))

    const filed = await fileAgentFileDraft({
      session,
      projectId: 'proj_1',
      ref: 'conv_1-kosten',
      title: 'Kosten',
      filename: 'Kosten.docx',
      contentType: DOCX,
      bytes: ooxml(),
      originConversationId: 'conv_1',
    })

    expect(filed).toMatchObject({ documentId: 'doc_1', alreadyFiled: false })
    const call = vi.mocked(fileGeneratedDocument).mock.calls[0][0]
    expect(call).toMatchObject({ producer: 'agent_file', ref: 'conv_1-kosten', filename: 'Kosten.docx' })
    expect(call.origin).toEqual({ conversationId: 'conv_1', locale: 'de' })
    const hash = vi.mocked(createDocumentVersion).mock.calls[0][1].contentHash
    expect(hash).not.toBe(contentDigest(ooxml()))
  })

  it('refuses a file that fails the output check before it touches the project', async () => {
    await expect(
      fileAgentFileDraft({ session, projectId: 'proj_1', ref: 'r', title: 'T', contentType: DOCX, bytes: png() }),
    ).rejects.toBeInstanceOf(AgentFileRefusedError)
    expect(fileGeneratedDocument).not.toHaveBeenCalled()
  })
})

describe('renderAgentFileVersion', () => {
  const draft = version({ contentType: DOCX })

  it('re-marks the new bytes with the document’s own ref and hashes what is stored', () => {
    const rendered = renderAgentFileVersion(agentFile, draft, { contentType: DOCX, bytes: ooxml() })
    expect(markingIsInBytes(rendered.bytes, generatedDocumentMarking('agent_file', 'conv_1-kosten'))).toBe(true)
    expect(rendered.contentHash).toBe(contentDigest(rendered.bytes))
    expect(rendered.contentType).toBe(DOCX)
  })

  it('refuses to change the type of a draft', () => {
    expect(() => renderAgentFileVersion(agentFile, draft, { contentType: 'image/png', bytes: png() })).toThrow(
      AgentFileRefusedError,
    )
  })

  it('refuses a document the agent did not file as a file', () => {
    const markdown = { ...agentFile, authoredByProducer: 'agent_document', contentType: 'text/markdown' }
    expect(() => renderAgentFileVersion(markdown, draft, { contentType: DOCX, bytes: ooxml() })).toThrow(ConflictError)
    const uploaded = { ...agentFile, authoredBy: 'user' as const }
    expect(() => renderAgentFileVersion(uploaded, draft, { contentType: DOCX, bytes: ooxml() })).toThrow(ConflictError)
  })
})

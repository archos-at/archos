/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./generated', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./generated')>()),
  fileGeneratedDocument: vi.fn(),
}))
vi.mock('@/lib/organizations/service', () => ({
  getOrgSettings: vi.fn(async () => ({ displayName: null, defaultLocale: 'de', settings: {} })),
  getOrganizationDisplayName: vi.fn(async () => 'Musterbüro ZT GmbH'),
}))
vi.mock('./lifecycle', () => ({ createDocumentVersion: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn() }))
vi.mock('./version-repository', () => ({ findOpenVersion: vi.fn(), findPublishedVersion: vi.fn() }))

import { aiProvenanceMarking, markingIsInBytes } from '@/lib/ai-provenance'
import { PLATFORM_DOCUMENT_BRANDING, resolveDocumentBranding } from './branding'
import { makeDocument } from '@/test-utils/db-fixtures'
import type { AuthorizedSession } from '@/lib/auth/types'
import { fileGeneratedDocument } from './generated'
import { createDocumentVersion } from './lifecycle'
import { findDocumentInOrg } from './repository'
import { findOpenVersion, findPublishedVersion } from './version-repository'
import {
  AGENT_DOCUMENT_MEDIA_TYPE,
  fileAgentDocumentDraft,
  renderAgentDocumentMarkdown,
} from './agent-document'
import { GENERATED_DOCUMENT_PRODUCER_REF_KINDS } from './generated'
import { PRODUCT_NAME } from '@/lib/brand'
import { getOrgSettings } from '@/lib/organizations/service'

const session = { userId: 'user_1', organizationId: 'org_1', email: 'a@example.test' } as AuthorizedSession

describe('renderAgentDocumentMarkdown', () => {
  const marking = aiProvenanceMarking({})
  const branding = {
    productName: PRODUCT_NAME,
    tagline: PLATFORM_DOCUMENT_BRANDING.copy.de.tagline,
    headerLine: `Erstellt mit ${PRODUCT_NAME} für Musterbüro ZT GmbH`,
    footerLine: `${PRODUCT_NAME} · Entwurf, nicht freigegeben`,
    prose: PLATFORM_DOCUMENT_BRANDING.copy.de.prose.replace('{product}', PRODUCT_NAME),
    disclaimer: PLATFORM_DOCUMENT_BRANDING.copy.de.disclaimer,
    logo: null,
    aiGeneratorName: PRODUCT_NAME,
    aiDisclosure: `Verfasst von ${PRODUCT_NAME}, einem KI-System, für Musterbüro ZT GmbH.`,
  }

  it('puts the marking IN the bytes, which is the only place Markdown has', () => {
    const rendered = renderAgentDocumentMarkdown('# Aktenvermerk\n\nGK 4.', marking, branding)
    expect(markingIsInBytes(rendered.bytes, marking)).toBe(true)
    expect(rendered.contentType).toBe(AGENT_DOCUMENT_MEDIA_TYPE)
  })

  it('keeps the marking as visible text, not as a comment a paste would drop', () => {
    const text = new TextDecoder().decode(
      renderAgentDocumentMarkdown('# Aktenvermerk', marking, branding).bytes,
    )
    expect(text).toMatch(/```\nAIGenerated=true;/)
    expect(text).toContain('DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia')
    expect(text.indexOf('# Aktenvermerk')).toBeLessThan(text.indexOf('AIGenerated=true'))
  })

  it('keeps the model’s own body intact', () => {
    const text = new TextDecoder().decode(
      renderAgentDocumentMarkdown('# Titel\n\n- eins\n- zwei', marking, branding).bytes,
    )
    expect(text).toContain('- eins\n- zwei')
  })

  it('carries the branding IN the bytes, which is the only place a file has', () => {
    const text = new TextDecoder().decode(
      renderAgentDocumentMarkdown('# Aktenvermerk', marking, branding).bytes,
    )
    expect(text).toContain(branding.headerLine)
    expect(text).toContain(branding.prose)
    expect(text).toContain(branding.disclaimer)
    expect(text).toContain(branding.footerLine)
    expect(text).toContain(`${branding.productName} — ${branding.tagline}`)
  })

  it('puts the header line above the title and the disclaimer below the body', () => {
    const text = new TextDecoder().decode(
      renderAgentDocumentMarkdown('# Aktenvermerk\n\nGK 4.', marking, branding).bytes,
    )
    expect(text.indexOf(branding.headerLine)).toBeLessThan(text.indexOf('# Aktenvermerk'))
    expect(text.indexOf('GK 4.')).toBeLessThan(text.indexOf(branding.prose))
    expect(text.indexOf(branding.prose)).toBeLessThan(text.indexOf('AIGenerated=true'))
  })

  it('opens with the Art. 50(1) disclosure, above the title, a letter to a Behörde included', () => {
    const text = new TextDecoder().decode(
      renderAgentDocumentMarkdown('# Ansuchen um Fristerstreckung\n\nSehr geehrte Damen und Herren,', marking, branding)
        .bytes,
    )
    expect(text.indexOf(branding.headerLine)).toBeLessThan(text.indexOf(branding.aiDisclosure))
    expect(text.indexOf(branding.aiDisclosure)).toBeLessThan(text.indexOf('# Ansuchen'))
  })
})

describe('the filing seam resolves the branding once', () => {
  it('hands the renderer the platform copy in the document’s language', async () => {
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro ZT GmbH',
      locale: 'de',
    })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME} für Musterbüro ZT GmbH`)
    expect(branding.aiGeneratorName).toBe(PRODUCT_NAME)
  })

  it('discloses the AI system and the office it acts for, in the document’s language', async () => {
    const de = await resolveDocumentBranding({ organizationId: 'org_1', organizationName: 'Musterbüro ZT GmbH', locale: 'de' })
    expect(de.aiDisclosure).toBe(`Verfasst von ${PRODUCT_NAME}, einem KI-System, für Musterbüro ZT GmbH.`)
    const en = await resolveDocumentBranding({ organizationId: 'org_1', organizationName: null, locale: 'en' })
    expect(en.aiDisclosure).toBe(`Written by ${PRODUCT_NAME}, an AI system.`)
  })

  it('keeps the disclosure when an office overrides its branding copy', async () => {
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      displayName: null,
      defaultLocale: 'de',
      homeCountry: 'AT',
      settings: { documentBranding: { copy: { de: { header: 'Büro {organization}', prose: 'Von uns.' } } } },
    } as Awaited<ReturnType<typeof getOrgSettings>>)
    const branding = await resolveDocumentBranding({ organizationId: 'org_1', organizationName: 'Musterbüro ZT GmbH', locale: 'de' })
    expect(branding.headerLine).toBe('Büro Musterbüro ZT GmbH')
    expect(branding.aiDisclosure).toBe(`Verfasst von ${PRODUCT_NAME}, einem KI-System, für Musterbüro ZT GmbH.`)
  })
})

describe('the producer is registered', () => {
  it('files under a reference kind that is not a run, because it is not one', () => {
    expect(GENERATED_DOCUMENT_PRODUCER_REF_KINDS.agent_document).toBe('answer_artifact')
  })
})

describe('fileAgentDocumentDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ id: 'doc_1' }))
    vi.mocked(createDocumentVersion).mockResolvedValue({ id: 'ver_1' } as never)
  })

  it('files the item first, then records version 1 by the op its caller names', async () => {
    vi.mocked(fileGeneratedDocument).mockResolvedValue({
      documentId: 'doc_1',
      filename: 'aktenvermerk-2026-09-10.md',
      folderId: 'fold_1',
      alreadyFiled: false,
    })

    const result = await fileAgentDocumentDraft({
      op: 'file',
      session,
      projectId: 'proj_1',
      ref: 's_conv_1-aktenvermerk',
      title: 'Aktenvermerk',
      content: '# Aktenvermerk',
    })

    expect(fileGeneratedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ producer: 'agent_document', ref: 's_conv_1-aktenvermerk' }),
    )
    expect(createDocumentVersion).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ op: 'file' }),
    )
    expect(result).toMatchObject({ documentId: 'doc_1', alreadyFiled: false })
  })

  it('hands the filing its origin, so a confined thread files only where it may (ADR-0087)', async () => {
    vi.mocked(fileGeneratedDocument).mockResolvedValue({
      documentId: 'doc_1',
      filename: 'honorar-2026-09-10.md',
      folderId: 'fold_1',
      alreadyFiled: false,
    })

    await fileAgentDocumentDraft({
      op: 'file',
      session,
      projectId: 'proj_1',
      ref: 's_conv_1-honorar',
      title: 'Honorar',
      content: '# Honorar',
      originConversationId: 's_conv_1',
    })
    expect(vi.mocked(fileGeneratedDocument).mock.calls[0][0].origin).toEqual({
      conversationId: 's_conv_1',
      locale: 'de',
    })
  })

  it('does not fork a second draft when the reference was already filed', async () => {
    vi.mocked(fileGeneratedDocument).mockResolvedValue({
      documentId: 'doc_1',
      filename: 'aktenvermerk-2026-09-10.md',
      folderId: 'fold_1',
      alreadyFiled: true,
    })
    vi.mocked(findOpenVersion).mockResolvedValue({ id: 'ver_existing' } as never)

    const result = await fileAgentDocumentDraft({
      op: 'create',
      session,
      projectId: 'proj_1',
      ref: 's_conv_1-aktenvermerk',
      title: 'Aktenvermerk',
      content: '# Aktenvermerk',
    })

    expect(createDocumentVersion).not.toHaveBeenCalled()
    expect(result).toMatchObject({ alreadyFiled: true, version: { id: 'ver_existing' } })
  })

  it('answers the published version, not a second one, when a filing that was signed off is filed again', async () => {
    vi.mocked(fileGeneratedDocument).mockResolvedValue({
      documentId: 'doc_1',
      filename: 'aktenvermerk-2026-09-10.md',
      folderId: 'fold_1',
      alreadyFiled: true,
    })
    vi.mocked(findOpenVersion).mockResolvedValue(null)
    vi.mocked(findPublishedVersion).mockResolvedValue({ id: 'ver_published', state: 'published' } as never)

    const result = await fileAgentDocumentDraft({
      op: 'file',
      session,
      projectId: 'proj_1',
      ref: 's_conv_1-aktenvermerk',
      title: 'Aktenvermerk',
      content: '# Aktenvermerk',
    })

    expect(createDocumentVersion).not.toHaveBeenCalled()
    expect(result).toMatchObject({ alreadyFiled: true, version: { id: 'ver_published' } })
  })
})

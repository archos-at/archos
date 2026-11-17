/**
 * @vitest-environment node
 *
 * ## Why this spec renders a real PDF
 *
 * The renderer is NOT mocked out. `fileGeneratedDocument` takes a `render`
 * function, and the claim this module is here to make is about what that
 * function produces — a file that previews in the Files pane and carries its
 * marking into the artifact that reaches a Behörde. A mocked renderer can only
 * confirm that arguments were passed to it, which is the same assertion whether
 * the PDF is well-formed or empty.
 *
 * It is still wrapped in a spy (`importOriginal`, not a stub) so the *when* —
 * nothing renders until the service has authorized the write — stays assertable
 * without giving up the *what*.
 *
 * `@vitest-environment node` is load-bearing: `@react-pdf/renderer`'s package
 * has a `browser` field, and under happy-dom the web build's `renderToStream`
 * throws "a web specific API".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const fileGeneratedDocument = vi.fn()
vi.mock('./generated', () => ({
  fileGeneratedDocument: (...args: unknown[]) => fileGeneratedDocument(...args),
}))

const renderMarkdownPdf = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pdf/markdown-pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf/markdown-pdf')>()
  renderMarkdownPdf.mockImplementation(actual.renderMarkdownPdf)
  return { ...actual, renderMarkdownPdf }
})

vi.mock('./lifecycle', () => ({
  createDocumentVersion: vi.fn(),
  transitionDocumentVersion: vi.fn(),
}))
vi.mock('./version-repository', () => ({ findOpenVersion: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn() }))

vi.mock('@/i18n/server', () => ({
  getTranslations: async () => (key: string) => `t:${key}`,
  getLocale: async () => 'de',
}))

vi.mock('@/lib/organizations/service', () => ({
  getOrgSettings: vi.fn(async () => ({ displayName: null, defaultLocale: 'de', settings: {} })),
  getOrganizationDisplayName: vi.fn(async () => 'Musterbüro ZT GmbH'),
}))

const findProjectInOrg = vi.hoisted(() => vi.fn())
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: (...args: unknown[]) => findProjectInOrg(...args),
}))

const PROFILE = {
  facts: {
    site_address: {
      value: 'Simmeringer Hauptstraße 24, 1110 Wien',
      confidence: 'confirmed',
      source: 'onboarding',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    federal_state: {
      value: 'vienna',
      confidence: 'confirmed',
      source: 'onboarding',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    building_class: {
      value: 'GK4',
      confidence: 'confirmed',
      source: 'user_confirmed',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    project_phase: {
      value: 'submission_planning',
      confidence: 'confirmed',
      source: 'onboarding',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  },
  goals: {},
  unknowns: [],
  assumptions: {},
}

import type { AuthorizedSession } from '@/lib/auth/types'
import { normalizePdfText, readPdf } from '@/test-utils/read-pdf'
import { MAX_MARKDOWN_PDF_CHARS, MarkdownTooLongError } from '@/lib/pdf/markdown-pdf'
import { aiProvenanceMarking } from '@/lib/ai-provenance'
import type { GeneratedRenderContext } from './generated'
import { createDocumentVersion, transitionDocumentVersion } from './lifecycle'
import { findDocumentInOrg } from './repository'
import { findOpenVersion } from './version-repository'
import { fileResearchReport, splitReportTitle } from './research-report'
import { PRODUCT_NAME } from '@/lib/brand'

const SESSION = { userId: 'user-1', organizationId: 'org-1' } as AuthorizedSession

const REPORT = '# Brandschutz Straßenhäuser\n\nDer Bericht beginnt hier.\n'

const RUN_MARKING = aiProvenanceMarking({ runId: 'run_7' })

const runRenderer = () => {
  const input = fileGeneratedDocument.mock.calls[0][0]
  const context: GeneratedRenderContext = {
    projectId: 'proj-1',
    projectName: 'Haus Anna',
    marking: RUN_MARKING,
  }
  return input.render(context)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T11:00:00Z'))
  vi.clearAllMocks()
  findProjectInOrg.mockResolvedValue({ id: 'proj-1', name: 'Haus Anna', profile: PROFILE })
  fileGeneratedDocument.mockResolvedValue({
    documentId: 'doc-1',
    filename: 'brandschutz-2026-08-20.pdf',
    folderId: 'folder-1',
    alreadyFiled: false,
  })
  vi.mocked(findOpenVersion).mockResolvedValue(null)
  vi.mocked(findDocumentInOrg).mockResolvedValue({
    id: 'doc-1',
    storageKey: 'org/org-1/project/proj-1/doc/doc-1/brandschutz-2026-08-20.pdf',
    storageBucket: 'grid-org-1',
    contentType: 'application/pdf',
    fileSize: 4096,
    contentHash: 'sha256:abc',
  } as never)
  vi.mocked(createDocumentVersion).mockResolvedValue({ id: 'ver-1' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('splitReportTitle', () => {
  it('takes the report’s own H1 as the title and removes it from the body', () => {
    expect(splitReportTitle(REPORT)).toEqual({
      title: 'Brandschutz Straßenhäuser',
      body: 'Der Bericht beginnt hier.\n',
    })
  })

  it('leaves a report without a heading untouched rather than inventing a title', () => {
    const plain = 'Der Bericht beginnt sofort.'
    expect(splitReportTitle(plain)).toEqual({ title: null, body: plain })
  })

  it('does not mistake a deeper heading for the document title', () => {
    const report = '## Abschnitt\n\nText.'
    expect(splitReportTitle(report).title).toBeNull()
  })
})

describe('fileResearchReport', () => {
  it('files through the one service function, as the deep_research producer', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })

    const input = fileGeneratedDocument.mock.calls[0][0]
    expect(input.producer).toBe('deep_research')
    expect(input.ref).toBe('run_7')
    expect(input.projectId).toBe('proj-1')
    expect(input.title).toBe('Brandschutz Straßenhäuser')
  })

  it('falls back to the export’s own title when the report has no heading', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: 'Text.' })
    expect(fileGeneratedDocument.mock.calls[0][0].title).toBe('t:documentTitle')
  })

  it('files a PDF — the type the Files pane can preview', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const rendering = await runRenderer()

    expect(rendering.contentType).toBe('application/pdf')
    expect(new TextDecoder('latin1').decode(rendering.bytes.subarray(0, 5))).toBe('%PDF-')
  })

  it('sets the printed notice AND the machine-readable provenance', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const rendering = await runRenderer()
    const pdf = await readPdf(rendering.bytes)

    expect(rendering.marking).toBe(RUN_MARKING)

    expect(pdf.text).toContain(normalizePdfText('KI-generiert — nicht geprüft'))
    expect(pdf.text).toContain(normalizePdfText('ein Mensch hat es nicht geprüft'))

    expect(pdf.info.Keywords).toBe(
      `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia; AIRunId=run_7`
    )
    expect(pdf.info.Creator).toBe(PRODUCT_NAME)
  })

  it('prints the header line, the prose and the footer line into the file', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const pdf = await readPdf((await runRenderer()).bytes)

    expect(pdf.text).toContain(normalizePdfText(`Erstellt mit ${PRODUCT_NAME} für Musterbüro ZT GmbH`))
    expect(pdf.text).toContain(normalizePdfText('Es ist ein Arbeitsstand und keine Freigabe'))
    expect(pdf.text).toContain(normalizePdfText('Entwurf, nicht freigegeben'))
    const disclosure = normalizePdfText(
      `Verfasst von ${PRODUCT_NAME}, einem KI-System, für Musterbüro ZT GmbH.`
    )
    expect(pdf.text).toContain(disclosure)
    expect(pdf.text.indexOf(normalizePdfText(`Erstellt mit ${PRODUCT_NAME} für`))).toBeLessThan(
      pdf.text.indexOf(disclosure)
    )

    expect(pdf.info.Keywords).toBe(
      `AIGenerated=true; AIGenerator=${PRODUCT_NAME}; AIHumanReviewed=false; DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia; AIRunId=run_7`
    )
  })

  it('opens with the title, then the marking, then the identifying facts', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const pdf = await readPdf((await runRenderer()).bytes)

    const marking = 'KI-generiert — nicht geprüft'
    expect(pdf.text).toContain(normalizePdfText(marking))

    const at = (needle: string) => pdf.text.indexOf(normalizePdfText(needle))
    expect(at(marking)).toBeGreaterThan(-1)
    for (const fact of ['Haus Anna', 'Simmeringer Hauptstraße 24, 1110 Wien', 'Wien', 'GK4', 'run_7']) {
      expect(at(marking), `marking precedes ${fact}`).toBeLessThan(at(fact))
    }
    expect(at(marking)).toBeLessThan(at('Der Bericht beginnt hier.'))

    for (const fact of [
      'Haus Anna',
      'Simmeringer Hauptstraße 24, 1110 Wien',
      'Wien',
      'GK4',
      '20. August 2026',
      'run_7',
    ]) {
      expect(pdf.text, `cover carries ${fact}`).toContain(normalizePdfText(fact))
    }
    expect(pdf.info.Title).toBe('Brandschutz Straßenhäuser')
  })

  it('sets the run id in monospace, and nothing else on the cover', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const { bytes } = await runRenderer()

    expect(new TextDecoder('latin1').decode(bytes).includes('Courier')).toBe(true)
  })

  it('prints the brief’s own words for a fact, not the stored token', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const pdf = await readPdf((await runRenderer()).bytes)

    expect(pdf.text).toContain('Wien')
    expect(pdf.text).not.toContain('vienna')
  })

  it('does not reprint the rest of the project brief', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const pdf = await readPdf((await runRenderer()).bytes)

    expect(pdf.text).not.toContain('Einreichplanung')
    expect(pdf.text).not.toContain('einreichplanung')
  })

  it('drops the facts a project has not captured, and keeps the rest', async () => {
    findProjectInOrg.mockResolvedValue({ id: 'proj-1', name: 'Haus Anna', profile: {} })
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const pdf = await readPdf((await runRenderer()).bytes)

    for (const label of ['t:reportCover.location', 't:reportCover.bundesland', 't:fields.gebaeudeklasse']) {
      expect(pdf.text, `${label} has no value, so it prints no line`).not.toContain(label)
    }
    expect(pdf.text).toContain('t:project Haus Anna')
    expect(pdf.text).toContain('t:reportCover.analysisId run_7')
    expect(pdf.text).toContain('Der Bericht beginnt hier.')
  })

  it('still files the report when the project brief cannot be read', async () => {
    findProjectInOrg.mockRejectedValue(new Error('connection terminated'))
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    const rendering = await runRenderer()
    const pdf = await readPdf(rendering.bytes)

    expect(rendering.contentType).toBe('application/pdf')
    expect(pdf.text).toContain(normalizePdfText('KI-generiert — nicht geprüft'))
    expect(pdf.text).toContain('t:project Haus Anna')
    expect(pdf.text).toContain('t:reportCover.analysisId run_7')
    expect(pdf.text).not.toContain('t:reportCover.bundesland')
  })

  it('files a marked, identified document for a report with no words in it', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: '' })
    const pdf = await readPdf((await runRenderer()).bytes)

    expect(pdf.pageCount).toBe(2)
    expect(pdf.text).toContain(normalizePdfText('KI-generiert — nicht geprüft'))
    expect(pdf.text).toContain('t:documentTitle')
    expect(pdf.text).toContain('t:reportCover.analysisId run_7')
  })

  describe('the legal basis', () => {
    const CARDS = [
      {
        type: 'calculation',
        title: 'Schrittmaßregel',
        steps: [{ label: 'Schrittmaß', operation: 'sum', operands: [{ label: 'Steigung', value: 17, factor: 2 }, { label: 'Auftritt', value: 30 }] }],
      },
    ]
    const QUOTING =
      '# Brandschutz Straßenhäuser\n\nDer Bericht beginnt hier.\n\n' +
      '> „Fluchtwege sind so auszubilden, dass sie im Brandfall sicher benützbar sind.“ [1]\n\n' +
      '## Quellen\n\n[1] [OIB] OIB-Richtlinie 2, Ausgabe Mai 2023\n'

    it('appends the cited Richtlinie and its excerpt as their own section', async () => {
      await fileResearchReport({
        session: SESSION,
        projectId: 'proj-1',
        runId: 'run_7',
        report: QUOTING,
        cards: CARDS,
      })
      const pdf = await readPdf((await runRenderer()).bytes)

      expect(pdf.text).toContain(normalizePdfText('Fluchtwege sind so auszubilden, dass sie im Brandfall sicher benützbar sind.'))
      expect(pdf.text).toContain('Rechtsgrundlagen')
      expect(pdf.text).toContain('Schrittmaßregel')
      expect(pdf.text.indexOf('Der Bericht beginnt hier.')).toBeLessThan(pdf.text.indexOf('Schrittmaßregel'))
    })

    it('leaves the report’s sanitized Quellen section exactly where it is', async () => {
      const report =
        '# Brandschutz Straßenhäuser\n\nDer Bericht beginnt hier.\n\n' +
        '## Quellen\n\n[1] [OIB] OIB-Richtlinie 2, Ausgabe Mai 2023\n'
      await fileResearchReport({
        session: SESSION,
        projectId: 'proj-1',
        runId: 'run_7',
        report,
        cards: CARDS,
      })
      const pdf = await readPdf((await runRenderer()).bytes)

      expect(pdf.text.match(/Quellen/g)).toHaveLength(1)
      expect(pdf.text).toContain(normalizePdfText('Quellen 1 [OIB] OIB-Richtlinie 2, Ausgabe Mai 2023'))
      expect(pdf.text.indexOf('Der Bericht beginnt hier.')).toBeLessThan(
        pdf.text.indexOf('Quellen')
      )
    })

    it('prints no section at all when the run produced no legal_basis card', async () => {
      await fileResearchReport({
        session: SESSION,
        projectId: 'proj-1',
        runId: 'run_7',
        report: REPORT,
      })
      const pdf = await readPdf((await runRenderer()).bytes)

      expect(pdf.text).not.toContain('t:legalBasis')
      expect(pdf.text.endsWith('Der Bericht beginnt hier.')).toBe(true)
    })
  })

  it('refuses a report the renderer will not accept, and files nothing', async () => {
    const body = 'Die Fluchtwegbreite betraegt 1,20 m. '.repeat(
      Math.ceil((MAX_MARKDOWN_PDF_CHARS + 1) / 37)
    )
    await fileResearchReport({
      session: SESSION,
      projectId: 'proj-1',
      runId: 'run_7',
      report: `# Brandschutz\n\n${body}`,
    })

    await expect(runRenderer()).rejects.toThrow(MarkdownTooLongError)
  })

  it('renders nothing until the service asks for it', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    expect(renderMarkdownPdf).not.toHaveBeenCalled()
    expect(findProjectInOrg).not.toHaveBeenCalled()
  })
})

describe('fileResearchReport opens a review round', () => {
  it('records version 1 as a draft and submits it to the commissioning person', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })

    expect(vi.mocked(createDocumentVersion).mock.calls[0][1]).toMatchObject({ op: 'create' })
    expect(transitionDocumentVersion).toHaveBeenCalledWith(SESSION, 'doc-1', 'ver-1', 'submit', {
      reviewerUserIds: ['user-1'],
      request: undefined,
      actingHuman: false,
    })
  })

  it('keeps the producer and the renderer exactly as they were', async () => {
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })
    expect(fileGeneratedDocument.mock.calls[0][0].producer).toBe('deep_research')
  })

  it('opens no second round for a report that already has an open version', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue({ id: 'ver-1' } as never)
    await fileResearchReport({ session: SESSION, projectId: 'proj-1', runId: 'run_7', report: REPORT })

    expect(createDocumentVersion).not.toHaveBeenCalled()
    expect(transitionDocumentVersion).not.toHaveBeenCalled()
  })

  it('still files the report when the review round cannot be opened', async () => {
    vi.mocked(createDocumentVersion).mockRejectedValue(new Error('no reviewers'))

    const filed = await fileResearchReport({
      session: SESSION,
      projectId: 'proj-1',
      runId: 'run_7',
      report: REPORT,
    })
    expect(filed.documentId).toBe('doc-1')
  })
})

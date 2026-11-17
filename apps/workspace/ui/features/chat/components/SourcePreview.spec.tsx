import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { buildCitationModel, CitationAccumulator, type CitationRef } from '../lib/citations'
import type { CitationSource } from '../types'
import { SourcePreviewChip } from './SourcePreview'
import { resetSourcePreviewIndexCache } from './source-preview/source-preview-index'

const startDocumentDownload = vi.fn(async (_id: string, _filename: string) => true)
vi.mock('@/lib/documents/download', () => ({
  startDocumentDownload: (id: string, filename: string) => startDocumentDownload(id, filename),
}))

vi.mock('../store', () => ({
  useChatStore: (
    selector: (s: {
      projectId: string | null
      currentConversation: { id: string } | null
    }) => unknown
  ) => selector({ projectId: 'project-1', currentConversation: { id: 'conv-1' } }),
}))

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data })

interface Row {
  id: string
  filename: string
  contentType: string | null
}

const PROJECT_ROWS: Row[] = [
  { id: 'doc-1', filename: 'Brandschutzkonzept.pdf', contentType: 'application/pdf' },
  {
    id: 'doc-word',
    filename: 'Raumprogramm.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { id: 'doc-sheet', filename: 'Kostenschaetzung.xlsx', contentType: null },
  { id: 'doc-deck', filename: 'Entwurf.pptx', contentType: null },
  { id: 'doc-gateway', filename: 'Statik.pdf', contentType: 'application/pdf' },
]

const OFFICE_SHELF_ROWS: Row[] = [
  { id: 'archiv-1', filename: 'Bueroe_Detail_Attika.pdf', contentType: 'application/pdf' },
]

const byName = (rows: Row[], init?: RequestInit) => {
  const names = (JSON.parse(String(init?.body)) as { names: string[] }).names.map((name) =>
    name.toLowerCase()
  )
  return jsonResponse({
    documents: rows
      .filter((row) => names.includes(row.filename.toLowerCase()))
      .map((row) => ({ ...row, createdAt: '2026-01-01T00:00:00.000Z' })),
  })
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url === '/api/documents/by-name') {
    const office = (JSON.parse(String(init?.body)) as { scope?: string }).scope === 'office_shelf'
    return Promise.resolve(byName(office ? OFFICE_SHELF_ROWS : PROJECT_ROWS, init))
  }
  if (url === '/api/documents/doc-sheet/preview') {
    return Promise.resolve({ ok: false, status: 415, json: async () => ({}) })
  }
  if (url === '/api/documents/doc-deck/preview') {
    return Promise.resolve({
      ok: false,
      status: 502,
      json: async () => ({ code: 'RENDITION_FAILED' }),
    })
  }
  if (url === '/api/documents/doc-gateway/preview') {
    return Promise.resolve({ ok: false, status: 502, json: async () => ({}) })
  }
  if (url === '/api/documents/doc-word/preview') {
    return Promise.resolve(
      jsonResponse({
        url: 'https://storage.example/_render.pdf',
        contentType: 'application/pdf',
        rendition: true,
      })
    )
  }
  if (url === '/api/knowledge-base') {
    return Promise.resolve(
      jsonResponse({
        files: [{ fileName: 'oib-rl_2.pdf', state: 'ingested' }],
      })
    )
  }
  if (url === '/api/session/documents?conversationId=conv-1') {
    return Promise.resolve(
      jsonResponse({
        documents: [
          { id: 'sess-1', filename: 'Brandschutzkonzept.pdf', contentType: 'application/pdf' },
        ],
        collectionName: 's_conv-1',
      })
    )
  }
  if (
    url === '/api/documents/doc-1/preview' ||
    url === '/api/documents/sess-1/preview' ||
    url === '/api/documents/archiv-1/preview'
  ) {
    return Promise.resolve(jsonResponse({ url: 'https://storage.example/presigned.pdf' }))
  }
  return Promise.resolve({ ok: false, json: async () => ({}) })
})

const citation = (overrides: Partial<CitationSource>): CitationSource => ({
  id: 'c-1',
  url: '',
  content: '',
  timestamp: new Date('2026-07-17T10:00:00Z'),
  ...overrides,
})

const ref = (overrides: Partial<CitationSource>): CitationRef => {
  const [document] = buildCitationModel({ citations: [citation(overrides)] })
  if (!document) throw new Error('fixture produced no document')
  return { document, locus: document.loci[0] }
}

describe('SourcePreviewChip', () => {
  beforeEach(() => {
    resetSourcePreviewIndexCache()
    fetchMock.mockClear()
    startDocumentDownload.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('web/RIS citations keep linking out and trigger no index fetch', () => {
    render(
      <SourcePreviewChip
        citation={ref({ kind: 'web', origin: 'web', url: 'https://example.com/article' })}
      />
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/article')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a RIS source peeks its bindingness and opens in the app, never as a bare link', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          title: 'WBTV',
          kind: 'building_law',
          lane: 'building_law_state',
          origin: 'ris',
          url: 'https://www.ris.bka.gv.at/x',
          laneLabel: 'Landesrecht',
          bindingNote: 'Macht die OIB-Richtlinien in Wien verbindlich.',
        })}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
    const chip = screen.getByRole('button', { name: 'Preview source: WBTV' })
    await user.hover(chip)

    expect(await screen.findByText('Binding effect')).toBeInTheDocument()
    expect(screen.getByText('Macht die OIB-Richtlinien in Wien verbindlich.')).toBeInTheDocument()
    expect(screen.getByText('Landesrecht')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in RIS/i })).toHaveAttribute(
      'href',
      'https://www.ris.bka.gv.at/x'
    )
    expect(screen.getByText('Open at this passage')).toBeInTheDocument()
  })

  test('a KB citation resolving to a project document opens the document dialog', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Brandschutzkonzept.pdf, p.3',
          citationKey: 'Brandschutzkonzept.pdf, p.3',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 3,
        })}
      />
    )

    const chip = await screen.findByRole('button', {
      name: 'Preview source: Brandschutzkonzept',
    })
    await user.click(chip)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Brandschutzkonzept')).toBeInTheDocument()
    expect(within(dialog).getByText('Project document')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1/preview')
    const byNameCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/documents/by-name')
    expect(JSON.parse(String(byNameCall?.[1]?.body))).toEqual({
      projectId: 'project-1',
      names: ['Brandschutzkonzept.pdf'],
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/documents?'))).toBe(false)
  })

  test('a chip resolving its document stays focused and busy, never disabled, and ignores a second press', async () => {
    let release: () => void = () => {}
    const routed = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input, init) =>
      String(input) === '/api/documents/doc-1/preview'
        ? new Promise((resolve) => {
            release = () => resolve(jsonResponse({ url: 'https://storage.example/presigned.pdf' }))
          })
        : routed(input, init)
    )
    try {
      const user = userEvent.setup()
      render(
        <SourcePreviewChip
          citation={ref({
            content: '[KB] Brandschutzkonzept.pdf, p.3',
            fileName: 'Brandschutzkonzept.pdf',
            collection: 'proj_1',
            kind: 'project',
            page: 3,
          })}
        />
      )
      const chip = await screen.findByRole('button', { name: 'Preview source: Brandschutzkonzept' })
      expect(chip).not.toHaveAttribute('title')

      await user.click(chip)
      expect(chip).not.toBeDisabled()
      expect(chip).toHaveAttribute('aria-busy', 'true')
      expect(chip).toHaveFocus()
      await user.click(chip)
      const presigns = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/documents/doc-1/preview')
      expect(presigns).toHaveLength(1)

      release()
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    } finally {
      fetchMock.mockImplementation(routed)
    }
  })

  test('an office citation opens its PDF rendition and keeps the original downloadable', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Raumprogramm.docx',
          fileName: 'Raumprogramm.docx',
          collection: 'proj_1',
          kind: 'project',
        })}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Preview source: Raumprogramm' }))

    const dialog = await screen.findByRole('dialog')
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-word/preview')
    expect(within(dialog).getByText('PDF preview of the original')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Download original/ }))
    expect(startDocumentDownload).toHaveBeenCalledWith('doc-word', 'Raumprogramm.docx')
  })

  test('a native PDF carries no rendition note', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Brandschutzkonzept.pdf, p.3',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 3,
        })}
      />
    )

    await user.click(
      await screen.findByRole('button', { name: 'Preview source: Brandschutzkonzept' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('PDF preview of the original')).toBeNull()
  })

  test.each([
    ['disabled (415)', 'Kostenschaetzung.xlsx', 'doc-sheet', 'Kostenschaetzung'],
    ['failed (502)', 'Entwurf.pptx', 'doc-deck', 'Entwurf'],
  ])(
    'an office citation whose rendition is %s falls back to the download',
    async (_case, fileName, id, title) => {
      const user = userEvent.setup()
      render(
        <SourcePreviewChip
          citation={ref({
            content: `[KB] ${fileName}`,
            fileName,
            collection: 'proj_1',
            kind: 'project',
          })}
        />
      )

      await user.click(await screen.findByRole('button', { name: `Preview source: ${title}` }))

      expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${id}/preview`)
      await vi.waitFor(() => expect(startDocumentDownload).toHaveBeenCalledWith(id, fileName))
      expect(screen.queryByRole('dialog')).toBeNull()

      await user.hover(screen.getByRole('button', { name: `Preview source: ${title}` }))
      expect(await screen.findByText('Download document')).toBeInTheDocument()
    }
  )

  test('a 502 on an ordinary PDF citation is a failure, not a silent download', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Statik.pdf, p.1',
          fileName: 'Statik.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 1,
        })}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Preview source: Statik' }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-gateway/preview'))
    expect(startDocumentDownload).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.hover(screen.getByRole('button', { name: 'Preview source: Statik' }))
    expect(screen.queryByText('Download document')).toBeNull()
  })

  test('a citation resolving to an org office shelf document opens it too', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Bueroe_Detail_Attika.pdf, p.2',
          citationKey: 'Bueroe_Detail_Attika.pdf, p.2',
          fileName: 'Bueroe_Detail_Attika.pdf',
          collection: 'archiv_1',
          kind: 'office',
          lane: 'office',
          page: 2,
        })}
      />
    )

    const chip = await screen.findByRole('button', {
      name: 'Preview source: Bueroe Detail Attika',
    })
    await user.click(chip)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/archiv-1/preview')
  })

  test('a citation on the session shelf opens THIS chat’s attachment, not the project copy', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] Brandschutzkonzept.pdf, p.3',
          citationKey: 'Brandschutzkonzept.pdf, p.3',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 's_conv-1',
          shelf: 'session',
          kind: 'project',
          page: 3,
        })}
      />
    )

    await user.click(
      await screen.findByRole('button', { name: 'Preview source: Brandschutzkonzept' })
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session/documents?conversationId=conv-1'
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/sess-1/preview')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/documents/doc-1/preview')
  })

  test('an unresolvable KB citation with a passage opens an info popover — no viewer', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          content: '[KB] unbekannt.pdf\nZitierter Absatz.',
          citationKey: 'unbekannt.pdf',
          fileName: 'unbekannt.pdf',
          kind: 'project',
        })}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Preview source: Unbekannt' }))

    expect(await screen.findByText('Cited passage')).toBeInTheDocument()
    expect(screen.getByText('Zitierter Absatz.')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  test('the popover names the canonical kind, not the coarser origin token', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({
          kind: 'building_law',
          content: '[KB] wr_bauordnung.pdf\n§ 119.',
          citationKey: 'wr_bauordnung.pdf',
          fileName: 'wr_bauordnung.pdf',
        })}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Preview source: Wr bauordnung' }))

    expect(await screen.findByText('Building law & guidelines')).toBeInTheDocument()
    expect(screen.queryByText('Project knowledge')).toBeNull()
  })

  test('a source with nothing beyond its name stays a plain, non-interactive chip', () => {
    const accumulator = new CitationAccumulator()
    accumulator.add({ identity: { label: 'OIB-Richtlinie 2' }, title: 'OIB-Richtlinie 2' })
    const [document] = accumulator.build()
    render(<SourcePreviewChip citation={{ document: document! }} />)

    expect(screen.getByText('OIB-Richtlinie 2')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a document read at several pages', () => {
  beforeEach(() => {
    resetSourcePreviewIndexCache()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const readAtSeveralPages = () =>
    buildCitationModel({
      citations: [
        citation({
          content: '[KB] Brandschutzkonzept.pdf, p.9',
          citationKey: 'Brandschutzkonzept.pdf, p.9',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 9,
          number: 2,
          isCited: true,
        }),
        citation({
          id: 'c-2',
          content: '[KB] Brandschutzkonzept.pdf, p.3\nFluchtwege sind freizuhalten.',
          citationKey: 'Brandschutzkonzept.pdf, p.3',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 3,
          number: 1,
          isCited: true,
        }),
        citation({
          id: 'c-3',
          content: '[KB] Brandschutzkonzept.pdf, p.14',
          citationKey: 'Brandschutzkonzept.pdf, p.14',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 14,
          isCited: false,
        }),
      ],
    })

  const openRail = async (user: ReturnType<typeof userEvent.setup>) => {
    const [document] = readAtSeveralPages()
    render(<SourcePreviewChip citation={{ document: document! }} />)
    await user.click(
      await screen.findByRole('button', { name: 'Preview source: Brandschutzkonzept' })
    )
    const dialog = await screen.findByRole('dialog')
    return within(dialog).getByRole('navigation', { name: /passages in this document/i })
  }

  test('every passage is reachable from the dialog, not just the first', async () => {
    const user = userEvent.setup()
    const rail = await openRail(user)
    const entries = within(rail).getAllByRole('listitem')

    expect(entries.map((entry) => entry.textContent)).toEqual([
      '[1]p. 3Fluchtwege sind freizuhalten.',
      '[2]p. 9',
      'Readp. 14',
    ])

    const buttons = entries.map((entry) => within(entry).getByRole('button'))
    expect(buttons[0]).toHaveAttribute('aria-current', 'true')

    await user.click(buttons[1]!)
    expect(buttons[1]).toHaveAttribute('aria-current', 'true')
    expect(buttons[0]).not.toHaveAttribute('aria-current')
  })

  test('the stepper reads straight through, and stops at the ends', async () => {
    const user = userEvent.setup()
    const rail = await openRail(user)
    const next = within(rail).getByRole('button', { name: 'Next passage' })
    const previous = within(rail).getByRole('button', { name: 'Previous passage' })
    const current = () =>
      within(rail)
        .getAllByRole('listitem')
        .findIndex((entry) => within(entry).getByRole('button').getAttribute('aria-current'))

    expect(current()).toBe(0)
    expect(previous).toBeDisabled()

    await user.click(next)
    expect(current()).toBe(1)
    await user.click(next)
    expect(current()).toBe(2)
    expect(next).toBeDisabled()

    await user.click(previous)
    expect(current()).toBe(1)
  })

  test('the rail follows the passage you move to', async () => {
    const scrollIntoView = vi.fn()
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)
    const user = userEvent.setup()
    const rail = await openRail(user)

    scrollIntoView.mockClear()
    await user.click(within(rail).getAllByRole('listitem')[2]!.querySelector('button')!)

    const scrolled = scrollIntoView.mock.instances.at(-1) as Element | undefined
    expect(scrolled?.textContent).toContain('p. 14')
  })

  test('a document read at ONE page still gets the rail, without a stepper', async () => {
    const user = userEvent.setup()
    const [document] = buildCitationModel({
      citations: [
        citation({
          content: '[KB] Brandschutzkonzept.pdf, p.3\nFluchtwege sind freizuhalten.',
          citationKey: 'Brandschutzkonzept.pdf, p.3',
          fileName: 'Brandschutzkonzept.pdf',
          collection: 'proj_1',
          kind: 'project',
          page: 3,
          number: 1,
          isCited: true,
        }),
      ],
    })

    render(<SourcePreviewChip citation={{ document: document! }} />)
    await user.click(
      await screen.findByRole('button', { name: 'Preview source: Brandschutzkonzept' })
    )

    const dialog = await screen.findByRole('dialog')
    const rail = within(dialog).getByRole('navigation', { name: /passages in this document/i })
    expect(within(rail).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual([
      '[1]p. 3Fluchtwege sind freizuhalten.',
    ])
    expect(within(rail).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(within(rail).queryByRole('button', { name: 'Next passage' })).toBeNull()
    expect(within(rail).queryByRole('button', { name: 'Previous passage' })).toBeNull()
  })

  test('the cited passage is shown once, in the rail', async () => {
    const user = userEvent.setup()
    const rail = await openRail(user)
    const dialog = screen.getByRole('dialog')

    expect(within(rail).getByText('Fluchtwege sind freizuhalten.')).toBeTruthy()
    expect(within(dialog).queryByText('Cited passage')).toBeNull()
  })
})

describe('a source from another project (ADR-0094)', () => {
  const traufe = {
    kind: 'project' as const,
    content: '[KB] Detail Traufe.pdf (Wohnbau Graz), p.3\nDie Traufe ist hinterlüftet ausgeführt.',
    citationKey: 'Detail Traufe.pdf (Wohnbau Graz), p.3',
    fileName: 'Detail Traufe.pdf',
  }

  test('its popover says Precedent, where a file of the chat’s own project says Project knowledge', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({ ...traufe, project: { id: 'project-9', name: 'Wohnbau Graz', status: 'closed' } })}
      />
    )

    await user.click(await screen.findByRole('button', { name: /Preview source/ }))

    expect(await screen.findByText('Precedent')).toBeInTheDocument()
    expect(screen.queryByText('Project knowledge')).toBeNull()
  })

  test('a file named with the chat’s own project is still its own, and says Project knowledge', async () => {
    const user = userEvent.setup()
    render(
      <SourcePreviewChip
        citation={ref({ ...traufe, project: { id: 'project-1', name: 'Seestadt D12', status: 'active' } })}
      />
    )

    await user.click(await screen.findByRole('button', { name: /Preview source/ }))

    expect(await screen.findByText('Project knowledge')).toBeInTheDocument()
    expect(screen.queryByText('Precedent')).toBeNull()
  })
})

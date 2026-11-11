import { render, screen, waitFor } from '@/test-utils'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { BaseKnowledge } from './base-knowledge'
import type { KnowledgeBaseStatus } from '@/lib/knowledge/service'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { platform as dePlatform } from '@/i18n/dictionaries/de/platform'
import { DOC_CLASS_LABELS } from '@/lib/knowledge/doc-class'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'

/**
 * The manager was rebuilt on the shared admin primitives (SectionCard +
 * DataToolbar + Table + Sheet + Pagination). These tests pin the CAPABILITIES,
 * not the old layout: every edit a row used to carry inline is still reachable
 * (now from the detail sheet or as a bulk action), and the list survives more
 * documents than fit on one screen.
 */

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// The in-app PDF viewer pulls in an iframe/dialog we don't exercise here.
// The dropzone is `useFileDragDrop`'s, which reads the app's upload config.
vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    fileUpload: {
      acceptedTypes: '.pdf,.zip',
      acceptedMimeTypes: ['application/pdf', 'application/zip'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))


vi.mock('@/features/knowledge/components/pdf-viewer-dialog', () => ({
  PdfViewerDialog: () => <div data-testid="pdf-viewer" />,
}))

function file(
  overrides: Partial<KnowledgeBaseStatus['files'][number]>
): KnowledgeBaseStatus['files'][number] {
  return {
    fileName: 'doc.pdf',
    state: 'ingested',
    sizeBytes: 1024,
    chunkCount: 4,
    ingestedSha256: null,
    currentSha256: null,
    countryId: null,
    ingestedAt: null,
    summary: null,
    docClass: 'other',
    docClassSuggestion: null,
    displayTitle: null,
    ...overrides,
  }
}

const STATUS: KnowledgeBaseStatus = {
  collectionName: 'oib',
  collectionExists: true,
  collectionUpdatedAt: null,
  summary: {
    totalFiles: 3,
    ingested: 3,
    stale: 0,
    pending: 0,
    failed: 0,
    removed: 0,
    inconsistent: 0,
    totalChunks: 12,
  },
  files: [
    file({ fileName: 'oib-richtlinie-2.pdf', docClass: 'oib_guideline' }),
    file({ fileName: 'oenorm-b-1600.pdf', docClass: 'external_standard' }),
    file({ fileName: 'sonstiges-notiz.pdf', docClass: 'other' }),
  ],
}

/** 14 documents — more than the page size, so the pager has something to do. */
const MANY: KnowledgeBaseStatus = {
  ...STATUS,
  summary: { ...STATUS.summary, totalFiles: 14, ingested: 14, totalChunks: 56 },
  files: Array.from({ length: 14 }, (_, index) =>
    file({
      fileName: `base-${String(index + 1).padStart(2, '0')}.pdf`,
      docClass: index === 0 ? 'oib_guideline' : 'other',
    })
  ),
}

function jsonResponse(body: unknown, ok = true, statusCode = 200) {
  return { ok, status: statusCode, json: async () => body } as Response
}

/** Open a row's detail sheet — where rename / reclassify / view / delete live now. */
async function openDetail(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Open details for ${name}` }))
  return screen.getByTestId('knowledge-detail')
}

/** Open the overflow menu and pick an entry. */
async function pickMenu(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

const requestsTo = (spy: ReturnType<typeof vi.fn>, match: string, method?: string) =>
  spy.mock.calls.filter(
    ([url, init]) =>
      typeof url === 'string' &&
      url.includes(match) &&
      (method === undefined || (init as RequestInit | undefined)?.method === method)
  )

describe('BaseKnowledge', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.success).mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('groups the files by the country of the record that names each, with its edition and change request', async () => {
    // The owner's complaint: an Austrian guideline looked like part of a shared, country-less pile.
    const placement = (corpusFile: string, countryId: string, released: boolean) => ({
      corpusFile,
      countryId,
      recordId: `manifestation:${corpusFile}`,
      editionId: 'edition:e',
      editionLabel: 'April 2019',
      workTitle: 'Brandschutz',
      released,
      changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e',
      changeRequestTitle: 'OIB 2019',
      changeRequestStatus: released ? 'published' : 'draft',
    })
    const texts = { texts: [placement('oib-richtlinie-2.pdf', 'AT', true), placement('oenorm-b-1600.pdf', 'DE', false)], nextCursor: null }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(jsonResponse(url.startsWith('/api/platform/knowledge/texts') ? texts : STATUS)))
    )

    render(<BaseKnowledge />)

    const groups = await screen.findAllByTestId('corpus-group')
    expect(groups.map((group) => group.textContent)).toEqual([
      'Austria',
      'Germany',
      expect.stringContaining('Assigned to no country'),
    ])
    // Each group opens above its own files, in table order.
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '')
    const at = (text: string) => rows.findIndex((row) => row.includes(text))
    expect(at('Austria')).toBeLessThan(at('oib-richtlinie-2.pdf'))
    expect(at('oib-richtlinie-2.pdf')).toBeLessThan(at('Germany'))
    expect(at('Germany')).toBeLessThan(at('oenorm-b-1600.pdf'))
    expect(at('Assigned to no country')).toBeLessThan(at('sonstiges-notiz.pdf'))

    const released = within(screen.getAllByRole('row')[at('oib-richtlinie-2.pdf')]!).getByTestId('corpus-placement')
    expect(released).toHaveTextContent('Brandschutz · April 2019')
    expect(released).toHaveTextContent('released')
    expect(within(released).getByRole('link', { name: 'Request “OIB 2019”' })).toHaveAttribute(
      'href',
      '/app/platform/countries/at/map?request=0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
    )
    expect(within(screen.getAllByRole('row')[at('oenorm-b-1600.pdf')]!).getByTestId('corpus-placement')).toHaveTextContent('not released yet')
    // A file no record names carries no placement; its group says so.
    expect(within(screen.getAllByRole('row')[at('sonstiges-notiz.pdf')]!).queryByTestId('corpus-placement')).toBeNull()
  })

  test('renders the corpus summary and every document as a table row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))

    render(<BaseKnowledge />)

    // The corpus summary — documents / indexed / pending / chunks — was
    // invisible before the rebuild.
    const summary = await screen.findByTestId('knowledge-summary')
    expect(within(summary).getByText('Documents')).toBeInTheDocument()
    expect(within(summary).getByText('Sections')).toBeInTheDocument()
    expect(within(summary).getByText('12')).toBeInTheDocument()
    expect(within(summary).getByText('Issues')).toBeInTheDocument()

    expect(screen.getByText('oib-richtlinie-2.pdf')).toBeInTheDocument()
    expect(screen.getByText('oenorm-b-1600.pdf')).toBeInTheDocument()
    expect(screen.getByText('sonstiges-notiz.pdf')).toBeInTheDocument()
    // The Dokumentart label surfaces per row, translated (it used to be German in every locale).
    expect(screen.getAllByText(/^OIB directive$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^OIB-Richtlinie$/)).not.toBeInTheDocument()
  })

  test('the binding-vs-other distinction survives in the type filter and the detail sheet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await user.click(screen.getByRole('combobox', { name: 'Document type' }))
    await user.click(screen.getByRole('option', { name: 'Binding OIB foundations' }))

    await waitFor(() => expect(screen.queryByText('oenorm-b-1600.pdf')).not.toBeInTheDocument())
    expect(screen.getByText('oib-richtlinie-2.pdf')).toBeInTheDocument()

    const sheet = await openDetail(user, 'oib-richtlinie-2.pdf')
    expect(within(sheet).getByText('Binding')).toBeInTheDocument()
  })

  test('the search box filters the list down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await user.type(screen.getByRole('textbox', { name: 'Filter documents' }), 'oenorm')

    await waitFor(() => expect(screen.queryByText('oib-richtlinie-2.pdf')).not.toBeInTheDocument())
    expect(screen.getByText('oenorm-b-1600.pdf')).toBeInTheDocument()
  })

  test('the Dokumentart dropdown in the detail sheet reflects the doc_class and PATCHes on change', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(STATUS))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'oenorm-b-1600.pdf')

    // The sheet's dropdown is pre-filled with the current class label.
    const trigger = within(sheet).getByRole('combobox', {
      name: /Document type for oenorm-b-1600\.pdf/i,
    })
    expect(trigger).toHaveTextContent('Standard (ÖNORM etc.)')

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Law / building code' }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            typeof url === 'string' &&
            url.includes('/api/platform/knowledge/documents/oenorm-b-1600.pdf/doc-class') &&
            (init as RequestInit | undefined)?.method === 'PATCH'
        )
      ).toBe(true)
    })

    const patchCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/doc-class') &&
        (init as RequestInit | undefined)?.method === 'PATCH'
    )
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      doc_class: 'law',
    })
  })

  test('a Dokumentart read from the text is offered, and accepting it is the same PATCH', async () => {
    const suggested = file({
      fileName: 'BO_Wien_konsolidiert.pdf',
      docClass: 'other',
      docClassSuggestion: 'law',
    })
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...STATUS, files: [...STATUS.files, suggested] }))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'BO_Wien_konsolidiert.pdf')

    // Offered beside the picker, never applied: the picker still shows the stored class.
    expect(within(sheet).getByText('Read from the text: Law / building code')).toBeInTheDocument()
    expect(
      within(sheet).getByRole('combobox', { name: /Document type for BO_Wien/i })
    ).toHaveTextContent('Other base document')
    expect(
      fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    ).toBe(false)

    await user.click(within(sheet).getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.includes('/BO_Wien_konsolidiert.pdf/doc-class') &&
          (init as RequestInit | undefined)?.method === 'PATCH'
      )
      expect(patch && JSON.parse((patch[1] as RequestInit).body as string)).toEqual({
        doc_class: 'law',
      })
    })
  })

  test('a suggestion equal to the stored class offers nothing', async () => {
    const same = file({
      fileName: 'b1600.pdf',
      docClass: 'external_standard',
      docClassSuggestion: 'external_standard',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ...STATUS, files: [...STATUS.files, same] }))
    )
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'b1600.pdf')
    expect(within(sheet).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  test('renaming from the detail sheet PATCHes the display-title endpoint with the new name', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(STATUS))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'oib-richtlinie-2.pdf')

    const input = within(sheet).getByRole('textbox', {
      name: 'Display name for oib-richtlinie-2.pdf',
    })
    await user.clear(input)
    await user.type(input, 'OIB-Richtlinie 2, Ausgabe Mai 2023')
    await user.click(within(sheet).getByRole('button', { name: 'Save name' }))

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.includes('/api/platform/knowledge/documents/oib-richtlinie-2.pdf/display-title') &&
          (init as RequestInit | undefined)?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        display_title: 'OIB-Richtlinie 2, Ausgabe Mai 2023',
      })
    })
  })

  test('the detail sheet opens the in-app PDF viewer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'oib-richtlinie-2.pdf')

    await user.click(within(sheet).getByRole('button', { name: 'View PDF' }))
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument()
  })

  test('reads the whole corpus from the platform route, never from the office listing', async () => {
    // The office listing holds only what is released to the operator's own office (ADR-0173);
    // the page manages every file, released or not.
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(STATUS)))
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    const urls = fetchSpy.mock.calls.map(([url]) => url)
    expect(urls).toContain('/api/platform/knowledge/documents')
    expect(urls.filter((url) => url.startsWith('/api/knowledge-base'))).toEqual([])
  })

  test('syncing the corpus posts to the sync endpoint', async () => {
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/sync') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ filesAdded: 1, filesTotal: 3 }))
      }
      return Promise.resolve(jsonResponse(STATUS))
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await pickMenu(user, /Sync corpus/)

    // Sync costs model calls on every new PDF, so it asks first and says so.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sync the corpus?')
    expect(dialog).toHaveTextContent(/costs model calls/)
    expect(requestsTo(fetchSpy, '/sync')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            typeof url === 'string' &&
            url === '/api/platform/knowledge/sync' &&
            (init as RequestInit | undefined)?.method === 'POST'
        )
      ).toBe(true)
    })
  })

  test('selecting rows reveals bulk actions and reclassifies every selected document', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(STATUS))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await user.click(screen.getByRole('checkbox', { name: 'Select oib-richtlinie-2.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select oenorm-b-1600.pdf' }))

    // The toolbar swaps to the selection bar.
    const selectionBar = await screen.findByTestId('data-toolbar-selection')
    expect(selectionBar).toHaveTextContent('2 selected')

    await user.click(within(selectionBar).getByRole('combobox', { name: 'Change document type' }))
    await user.click(screen.getByRole('option', { name: 'Law / building code' }))

    await waitFor(() => {
      const patched = fetchSpy.mock.calls
        .filter(
          ([url, init]) =>
            typeof url === 'string' &&
            url.includes('/doc-class') &&
            (init as RequestInit | undefined)?.method === 'PATCH'
        )
        .map(([url]) => url as string)
      expect(patched).toHaveLength(2)
      expect(patched.some((url) => url.includes('oib-richtlinie-2.pdf'))).toBe(true)
      expect(patched.some((url) => url.includes('oenorm-b-1600.pdf'))).toBe(true)
    })
  })

  test('re-indexing sends exactly the selected documents in one request', async () => {
    // Sync is incremental and gates on each PDF's sha256, so it does nothing for an
    // unchanged file. This is the control for rebuilding chunks after a change to how
    // they are BUILT, and it must not touch documents the admin did not select.
    const fetchSpy = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/reingest')) {
        return Promise.resolve(
          jsonResponse({
            status: 'pending',
            queued: ['oib-richtlinie-2.pdf'],
            unknown: [],
            message: 'ok',
          })
        )
      }
      return Promise.resolve(jsonResponse(STATUS))
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await user.click(screen.getByRole('checkbox', { name: 'Select oib-richtlinie-2.pdf' }))
    const selectionBar = await screen.findByTestId('data-toolbar-selection')
    await user.click(within(selectionBar).getByRole('button', { name: /Re-index/i }))

    // Re-indexing re-runs OCR, captioning and embedding: confirm, with the scope named.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Re-index 1 document?')
    expect(within(dialog).getByTestId('confirm-name-list')).toHaveTextContent(
      'oib-richtlinie-2.pdf'
    )
    expect(dialog).toHaveTextContent(/costs model calls/)
    expect(requestsTo(fetchSpy, '/reingest')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Re-index 1 document' }))

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/reingest')
      )
      expect(calls).toHaveLength(1)
      const [, init] = calls[0]
      expect((init as RequestInit).method).toBe('POST')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        fileNames: ['oib-richtlinie-2.pdf'],
      })
    })
  })

  test('re-indexing nothing the corpus still has reports it instead of claiming success', async () => {
    const fetchSpy = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/reingest')) {
        return Promise.resolve(
          jsonResponse({ status: 'noop', queued: [], unknown: ['gone.pdf'], message: '' })
        )
      }
      return Promise.resolve(jsonResponse(STATUS))
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await user.click(screen.getByRole('checkbox', { name: 'Select oib-richtlinie-2.pdf' }))
    const selectionBar = await screen.findByTestId('data-toolbar-selection')
    await user.click(within(selectionBar).getByRole('button', { name: /Re-index/i }))
    await user.click(await screen.findByTestId('knowledge-reingest-confirm'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())

    // The selection survives, because nothing was started and the admin may want to retry.
    await waitFor(() => {
      expect(screen.getByTestId('data-toolbar-selection')).toHaveTextContent('1 selected')
    })
  })

  test('pages through a corpus larger than one page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(MANY)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('base-01.pdf')

    // Page one holds ten of the fourteen documents.
    expect(screen.getByText('1–10 of 14')).toBeInTheDocument()
    expect(screen.queryByText('base-14.pdf')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Next/ }))

    expect(await screen.findByText('base-14.pdf')).toBeInTheDocument()
    expect(screen.getByText('11–14 of 14')).toBeInTheDocument()
    expect(screen.queryByText('base-02.pdf')).not.toBeInTheDocument()
  })

  test('sorting by document name reverses the visible page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(MANY)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('base-01.pdf')

    // First click sorts ascending by name, second descending.
    const header = screen.getByRole('button', { name: 'Sort by Document' })
    await user.click(header)
    await user.click(header)

    expect(await screen.findByText('base-14.pdf')).toBeInTheDocument()
    expect(screen.queryByText('base-01.pdf')).not.toBeInTheDocument()
  })

  test('a failed status load offers a retry that refetches', async () => {
    let loads = 0
    const fetchSpy = vi.fn((url: string) => {
      if (url.startsWith('/api/platform/knowledge/texts')) return Promise.resolve(jsonResponse({ texts: [], nextCursor: null }))
      loads += 1
      return Promise.resolve(loads === 1 ? jsonResponse({ error: 'nope' }, false, 500) : jsonResponse(STATUS))
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)

    expect(await screen.findByText('The knowledge base could not be loaded.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/i }))

    expect(await screen.findByText('oib-richtlinie-2.pdf')).toBeInTheDocument()
  })

  test('the German document-type labels equal the backend vocabulary', () => {
    // The UI reads the dictionary, the parity test pins DOC_CLASS_LABELS to the
    // Python file; this keeps the two German spellings from drifting apart.
    expect(dePlatform.knowledge.docClasses).toEqual(DOC_CLASS_LABELS)
  })

  test('a failed refresh keeps the loaded table and says so in a toast', async () => {
    // Regression: any failed load set the status to null, so a transient error
    // after a reclassify replaced the whole table with an error card.
    let loads = 0
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ ok: true }))
      if (url.startsWith('/api/platform/knowledge/texts')) return Promise.resolve(jsonResponse({ texts: [], nextCursor: null }))
      loads += 1
      return Promise.resolve(
        loads === 1 ? jsonResponse(STATUS) : jsonResponse({ error: 'flaky' }, false, 502)
      )
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'oenorm-b-1600.pdf')
    await user.click(within(sheet).getByRole('combobox', { name: /Document type for oenorm/ }))
    await user.click(screen.getByRole('option', { name: 'Law / building code' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'The list could not be refreshed. Showing the last loaded state.'
      )
    )
    expect(screen.queryByText('The knowledge base could not be loaded.')).not.toBeInTheDocument()
    // `hidden`: the open sheet aria-hides the page; the row is still rendered behind it.
    expect(
      screen.getByRole('button', { name: 'Open details for oib-richtlinie-2.pdf', hidden: true })
    ).toBeInTheDocument()
  })

  test('cancelling the sync or re-index confirm sends nothing', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(STATUS))
    vi.stubGlobal('fetch', fetchSpy)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('oib-richtlinie-2.pdf')

    await pickMenu(user, /Sync corpus/)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('checkbox', { name: 'Select oenorm-b-1600.pdf' }))
    await user.click(
      within(screen.getByTestId('data-toolbar-selection')).getByRole('button', { name: /Re-index/ })
    )
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(requestsTo(fetchSpy, '/sync')).toHaveLength(0)
    expect(requestsTo(fetchSpy, '/reingest')).toHaveLength(0)
  })

  test('documents with issues can be re-indexed together from the overflow menu', async () => {
    const withIssues: KnowledgeBaseStatus = {
      ...STATUS,
      summary: { ...STATUS.summary, totalFiles: 5, ingested: 3, failed: 1, stale: 1 },
      files: [
        ...STATUS.files,
        file({ fileName: 'broken.pdf', state: 'failed', chunkCount: 0 }),
        file({ fileName: 'old.pdf', state: 'stale' }),
      ],
    }
    const fetchSpy = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/reingest')) {
        return Promise.resolve(
          jsonResponse({ status: 'pending', queued: ['broken.pdf', 'old.pdf'], unknown: [] })
        )
      }
      return Promise.resolve(jsonResponse(withIssues))
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    expect(
      within(await screen.findByTestId('knowledge-summary-issues')).getByText('2')
    ).toBeInTheDocument()

    await pickMenu(user, /Re-index issues \(2\)/)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Re-index 2 documents?')
    await user.click(within(dialog).getByRole('button', { name: 'Re-index 2 documents' }))

    await waitFor(() => {
      const [call] = requestsTo(fetchSpy, '/reingest', 'POST')
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        fileNames: ['broken.pdf', 'old.pdf'],
      })
    })
  })

  test('the status filter narrows the table to documents that need attention', async () => {
    const withIssue: KnowledgeBaseStatus = {
      ...STATUS,
      files: [...STATUS.files, file({ fileName: 'broken.pdf', state: 'failed', chunkCount: 0 })],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(withIssue)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    await screen.findByText('broken.pdf')
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Has issues' }))

    await waitFor(() => expect(screen.queryByText('oib-richtlinie-2.pdf')).not.toBeInTheDocument())
    expect(screen.getByText('broken.pdf')).toBeInTheDocument()
  })

  test('the detail sheet states what a status means in visible text', async () => {
    const withIssue: KnowledgeBaseStatus = {
      ...STATUS,
      files: [...STATUS.files, file({ fileName: 'broken.pdf', state: 'failed', chunkCount: 0 })],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(withIssue)))
    const user = userEvent.setup()

    render(<BaseKnowledge />)
    const sheet = await openDetail(user, 'broken.pdf')
    expect(within(sheet).getByTestId('knowledge-detail-state-hint')).toHaveTextContent(
      /Processing did not finish/
    )
  })

  test('read-only platform staff see the corpus without any write control', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))
    const user = userEvent.setup()

    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
        <BaseKnowledge />
      </PlatformAccessProvider>
    )
    await screen.findByText('oib-richtlinie-2.pdf')

    expect(screen.getByTestId('knowledge-read-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add documents/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    const sheet = await openDetail(user, 'oib-richtlinie-2.pdf')
    expect(within(sheet).getByRole('button', { name: 'View PDF' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('combobox')).not.toBeInTheDocument()
  })

  test('offers no way to add or delete a text: a text enters the corpus through its country’s change request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(STATUS)))
    render(<BaseKnowledge />)
    await screen.findByTestId('platform-base-knowledge')
    expect(screen.queryByRole('button', { name: /Add documents/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-upload-input')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })
})

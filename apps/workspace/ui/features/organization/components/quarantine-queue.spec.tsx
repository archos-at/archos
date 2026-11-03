import { fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { filesCopy } from '@/i18n/namespaces/files'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { describeQuarantineReason, type QuarantineReason } from '@/lib/upload-screening/quarantine'
import { QuarantineQueue } from './quarantine-queue'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'

const TERM: QuarantineReason = { kind: 'term', term: 'Honorarvereinbarung', count: 3, pages: [1, 4] }
const IBAN: QuarantineReason = { kind: 'iban', sample: 'AT61 •••• •••• •••• 3456', count: 2 }

const ITEMS = [
  {
    id: 'doc-1',
    filename: 'Honorar.pdf',
    scope: 'project',
    projectId: 'proj_1',
    conversationId: null,
    uploadedBy: 'user_01',
    quarantinedAt: '2026-09-30T10:00:00.000Z',
    verdict: { reasons: [TERM], checked: 'full' },
  },
  {
    id: 'doc-2',
    filename: 'Konten.xlsx',
    scope: 'office_shelf',
    projectId: null,
    conversationId: null,
    uploadedBy: 'user_02',
    quarantinedAt: '2026-09-29T10:00:00.000Z',
    verdict: { reasons: [IBAN], checked: 'partial' },
  },
  {
    id: 'doc-3',
    filename: 'Anhang.pdf',
    scope: 'session',
    projectId: null,
    conversationId: 'conv_1',
    uploadedBy: 'user_03',
    quarantinedAt: '2026-09-28T10:00:00.000Z',
    verdict: null,
  },
]

type Responder = (url: string, init?: RequestInit) => Response | undefined

function stubApi(items: unknown[] = ITEMS, override: Responder = () => undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const custom = override(url, init)
      if (custom) return custom
      if (url === '/api/quarantine') return Response.json({ items })
      if (url === '/api/projects') return Response.json([{ id: 'proj_1', name: 'Wohnbau Nord' }])
      if (url.endsWith('/quarantine/release')) return Response.json({ id: 'doc-1', status: 'pending', jobId: 'j1' })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response(null, { status: 404 })
    })
  )
}

const calledWith = (url: string, method: string): boolean =>
  vi.mocked(fetch).mock.calls.some(([called, init]) => called === url && init?.method === method)

describe('QuarantineQueue', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('renders each reason in the phrase the upload summary uses', async () => {
    stubApi()
    render(<QuarantineQueue />)
    const tFiles = translatorFor(filesCopy, 'en')
    const first = await screen.findByTestId('quarantine-row-doc-1')
    expect(within(first).getByText(describeQuarantineReason(TERM, tFiles))).toBeInTheDocument()
    expect(within(first).getByText('“Honorarvereinbarung” in the text · pages 1, 4')).toBeInTheDocument()
    const second = screen.getByTestId('quarantine-row-doc-2')
    expect(within(second).getByText(describeQuarantineReason(IBAN, tFiles))).toBeInTheDocument()
    // A partly checked scan says so; a verdict that could not be read says that.
    expect(within(second).getByText(filesCopy.messages.en.screening.partial)).toBeInTheDocument()
    expect(within(screen.getByTestId('quarantine-row-doc-3')).getByText(organizationCopy.messages.en.quarantine.noReason)).toBeInTheDocument()
  })

  it('says the findings through the same component as the preview, pages as text, and when the list is cut', async () => {
    const cut: QuarantineReason = { kind: 'term', term: 'Lohnzettel', count: 80, pages: [1, 2], pages_truncated: true }
    stubApi([{ ...ITEMS[0], verdict: { reasons: [cut], checked: 'full' } }])
    render(<QuarantineQueue />)
    const findings = await screen.findByTestId('quarantine-findings-doc-1')
    expect(within(findings).getByText('“Lohnzettel” in the text · pages 1, 2, …')).toBeInTheDocument()
    // The pages are buttons only where the document is open beside them.
    expect(within(findings).queryByRole('button')).toBeNull()
    // The queue does not explain holding back to the people who decide about it.
    expect(within(findings).queryByText(filesCopy.messages.en.ingestFailure.quarantined)).toBeNull()
  })

  it('says where each file was uploaded, by project name when it can', async () => {
    stubApi()
    render(<QuarantineQueue />)
    await waitFor(() =>
      expect(within(screen.getByTestId('quarantine-row-doc-1')).getByText(/Project Wohnbau Nord/)).toBeInTheDocument()
    )
    expect(within(screen.getByTestId('quarantine-row-doc-2')).getByText(/Office filing/)).toBeInTheDocument()
    expect(within(screen.getByTestId('quarantine-row-doc-3')).getByText(/Chat attachment/)).toBeInTheDocument()
  })

  // T4.2: the reviewer looks at the file from where they decide.
  it('links a project file and a Büroablage file to where they are filed, opened on them', async () => {
    stubApi()
    render(<QuarantineQueue />)
    expect(await screen.findByTestId('quarantine-open-doc-1')).toHaveAttribute(
      'href',
      '/app/projects/proj_1/files?doc=doc-1'
    )
    expect(screen.getByTestId('quarantine-open-doc-2')).toHaveAttribute('href', '/app/office-shelf?doc=doc-2')
    // A chat attachment has no per-file view.
    expect(screen.queryByTestId('quarantine-open-doc-3')).not.toBeInTheDocument()
  })

  it('release asks first, posts to the release endpoint, and removes the row', async () => {
    stubApi()
    render(<QuarantineQueue />)
    fireEvent.click(await screen.findByTestId('quarantine-release-doc-1'))
    expect(calledWith('/api/documents/doc-1/quarantine/release', 'POST')).toBe(false)
    expect(screen.getByRole('dialog')).toHaveTextContent(/language models see its content/)

    fireEvent.click(screen.getByTestId('quarantine-release-confirm'))
    await waitFor(() => expect(screen.queryByTestId('quarantine-row-doc-1')).not.toBeInTheDocument())
    expect(calledWith('/api/documents/doc-1/quarantine/release', 'POST')).toBe(true)
    expect(toast.success).toHaveBeenCalled()
    expect(screen.getByTestId('quarantine-row-doc-2')).toBeInTheDocument()
  })

  it.each(['doc-1', 'doc-2', 'doc-3'])(
    'delete of %s goes through the decision route, which deletes only what is still held, and removes the row',
    async (id) => {
      stubApi(ITEMS, (url) =>
        url === '/api/quarantine/decisions' ? Response.json({ results: [{ id, outcome: 'deleted' }] }) : undefined
      )
      render(<QuarantineQueue />)
      fireEvent.click(await screen.findByTestId(`quarantine-delete-${id}`))
      fireEvent.click(screen.getByTestId('quarantine-delete-confirm'))
      await waitFor(() => expect(screen.queryByTestId(`quarantine-row-${id}`)).not.toBeInTheDocument())
      expect(calledWith('/api/quarantine/decisions', 'POST')).toBe(true)
    }
  )

  it('keeps the row when the delete is refused, and says why for a chat attachment', async () => {
    stubApi(ITEMS, (url) =>
      url === '/api/quarantine/decisions' ? Response.json({ results: [{ id: 'doc-3', outcome: 'not_found' }] }) : undefined
    )
    render(<QuarantineQueue />)
    fireEvent.click(await screen.findByTestId('quarantine-delete-doc-3'))
    fireEvent.click(screen.getByTestId('quarantine-delete-confirm'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only people in that chat can delete a chat attachment.'))
    expect(await screen.findByTestId('quarantine-row-doc-3')).toBeInTheDocument()
  })

  it('says a file whose reading ended without a verdict was not checked, rather than that its reason is unreadable', async () => {
    stubApi([{ ...ITEMS[2], id: 'doc-f', held: 'unscreened' }, ITEMS[2]])
    render(<QuarantineQueue />)
    const unscreened = await screen.findByTestId('quarantine-row-doc-f')
    expect(within(unscreened).getByText(organizationCopy.messages.en.quarantine.unscreened)).toBeInTheDocument()
    expect(within(screen.getByTestId('quarantine-row-doc-3')).getByText(organizationCopy.messages.en.quarantine.noReason)).toBeInTheDocument()
    expect(within(unscreened).getByTestId('quarantine-release-doc-f')).toBeInTheDocument()
  })

  it('shows an empty state when nothing waits', async () => {
    stubApi([])
    render(<QuarantineQueue />)
    expect(await screen.findByTestId('quarantine-empty')).toHaveTextContent('Nothing is waiting for review')
  })

  describe('several at once', () => {
    const CARD: QuarantineReason = { kind: 'credit_card', sample: '•••• 4444', count: 1 }
    const cardRow = (id: string) => ({ ...ITEMS[0], id, filename: `${id}.pdf`, verdict: { reasons: [CARD], checked: 'full' } })
    const decisions = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/quarantine/decisions').map(([, init]) => JSON.parse(String(init?.body)))

    it('filters by what held the files, picks all shown, and allows them in one request', async () => {
      stubApi([cardRow('card-a'), cardRow('card-b'), ITEMS[0]], (url, init) =>
        url === '/api/quarantine/decisions'
          ? Response.json({
              results: (JSON.parse(String(init?.body)).documentIds as string[]).map((id) => ({ id, outcome: 'allowed' })),
            })
          : undefined
      )
      render(<QuarantineQueue />)
      fireEvent.click(await screen.findByTestId('quarantine-filter-credit_card'))
      expect(screen.queryByTestId('quarantine-row-doc-1')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('quarantine-select-all'))
      expect(screen.getByTestId('quarantine-selection')).toHaveTextContent('2 selected')
      fireEvent.click(screen.getByTestId('quarantine-release-selected'))
      fireEvent.click(await screen.findByTestId('quarantine-release-confirm'))

      await waitFor(() => expect(decisions()).toEqual([{ decision: 'allow', documentIds: ['card-a', 'card-b'] }]))
      await waitFor(() => expect(screen.queryByTestId('quarantine-row-card-a')).not.toBeInTheDocument())
      expect(toast.success).toHaveBeenCalled()
      // The card filter is empty now, so the list falls back to everything left.
      expect(screen.getByTestId('quarantine-row-doc-1')).toBeInTheDocument()
    })

    it('keeps a file the server could not decide, selected, and says so', async () => {
      stubApi([cardRow('card-a'), cardRow('card-b')], (url) =>
        url === '/api/quarantine/decisions'
          ? Response.json({ results: [{ id: 'card-a', outcome: 'deleted' }, { id: 'card-b', outcome: 'failed' }] })
          : undefined
      )
      render(<QuarantineQueue />)
      fireEvent.click(await screen.findByTestId('quarantine-select-card-a'))
      fireEvent.click(screen.getByTestId('quarantine-select-card-b'))
      fireEvent.click(screen.getByTestId('quarantine-delete-selected'))
      fireEvent.click(await screen.findByTestId('quarantine-delete-confirm'))

      await waitFor(() => expect(screen.queryByTestId('quarantine-row-card-a')).not.toBeInTheDocument())
      expect(decisions()).toEqual([{ decision: 'delete', documentIds: ['card-a', 'card-b'] }])
      expect(screen.getByTestId('quarantine-row-card-b')).toBeInTheDocument()
      expect(screen.getByTestId('quarantine-selection')).toHaveTextContent('1 selected')
      expect(toast.error).toHaveBeenCalled()
    })

    it('checks the selection again with the rules in force now; the rows leave until they match again', async () => {
      stubApi([cardRow('card-a'), cardRow('card-b')], (url, init) =>
        url === '/api/quarantine/decisions'
          ? Response.json({
              results: (JSON.parse(String(init?.body)).documentIds as string[]).map((id) => ({ id, outcome: 'rechecking' })),
            })
          : undefined
      )
      render(<QuarantineQueue />)
      fireEvent.click(await screen.findByTestId('quarantine-select-all'))
      fireEvent.click(screen.getByTestId('quarantine-recheck-selected'))

      await waitFor(() => expect(decisions()).toEqual([{ decision: 'recheck', documentIds: ['card-a', 'card-b'] }]))
      await waitFor(() => expect(screen.queryByTestId('quarantine-row-card-a')).not.toBeInTheDocument())
      expect(toast.success).toHaveBeenCalled()
    })

    it('drops the picks when the filter changes, so nothing hidden is acted on', async () => {
      stubApi([cardRow('card-a'), ITEMS[0]])
      render(<QuarantineQueue />)
      fireEvent.click(await screen.findByTestId('quarantine-select-card-a'))
      expect(screen.getByTestId('quarantine-selection')).toHaveTextContent('1 selected')
      fireEvent.click(screen.getByTestId('quarantine-filter-term'))
      expect(screen.getByTestId('quarantine-selection')).not.toHaveTextContent('selected')
    })

    it('counts a quarantine with no readable reason under no finding, and a file not read to the end as not checked', async () => {
      stubApi([{ ...ITEMS[2], id: 'doc-f', held: 'unscreened' }, ITEMS[2], cardRow('card-a')])
      render(<QuarantineQueue />)
      expect(await screen.findByTestId('quarantine-filter-unscreened')).toHaveTextContent('1')
    })
  })
})

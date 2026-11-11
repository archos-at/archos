import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { ChangeRequestReview } from './change-request-review'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: 'reviewer' } }) }))

/**
 * The text of an edition on its change request (ADR-0165, "Texts are attached
 * in the request"): the reviewer opens it beside the record, and in a draft
 * whoever may write platform knowledge attaches it there, by upload or by URL.
 */

const ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const BASE = `/api/platform/knowledge/change-requests/${ID}`

const TEXT = {
  revisionId: 'r1',
  recordId: 'manifestation:at-oib-rl-1-2019-text',
  editionId: 'edition:at-oib-rl-1-2019',
  corpusFile: 'oib-rl-1-2019.pdf',
  origin: 'url',
  sha256: 'c'.repeat(64),
  bytes: 1_400_000,
  pages: 12,
  sourceId: 'at-oib',
  url: 'https://www.oib.or.at/files/oib-rl-1-2019.pdf',
  attachedBy: 'u',
  attachedAt: '2026-11-11T09:00:00Z',
}

const request = (status: string, texts: unknown[]) => ({
  id: ID,
  title: 'OIB 2019',
  countryId: 'AT',
  status,
  createdBy: 'u',
  createdAt: '2026-11-10T00:00:00Z',
  submittedAt: null,
  publishedAt: null,
  approval: 'four_eyes',
  secondReview: null,
  secondReviewRoles: [],
  approvals: [],
  releases: [],
  captures: [],
  sourcesUnchecked: false,
  texts,
  revisions: [
    {
      revisionId: 'r1',
      recordId: 'manifestation:at-oib-rl-1-2019-text',
      type: 'manifestation',
      createdBy: 'u',
      citations: [],
      claims: [{ path: 'corpusFile', value: texts.length > 0 ? 'oib-rl-1-2019.pdf' : null, decision: null }],
    },
  ],
})

const fetchMock = vi.fn()

function serve(view: ReturnType<typeof request>) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? Response.json({ text: TEXT, status: 'written', stored: true }, { status: 201 }) : Response.json(view),
  )
}

const review = (permissions: string[]) => (
  <PlatformAccessProvider permissions={permissions}>
    <Dialog open>
      <DialogContent closeLabel="Close">
        <ChangeRequestReview id={ID} canManage={permissions.includes(PLATFORM_PERMISSIONS.knowledgeReview)} onChanged={() => undefined} />
      </DialogContent>
    </Dialog>
  </PlatformAccessProvider>
)

const READ = [PLATFORM_PERMISSIONS.settingsView]
const WRITE = [...READ, PLATFORM_PERMISSIONS.knowledgeWrite]

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('a manifestation’s text on its change request', () => {
  test('the reviewer opens the text beside the edition and sees where it came from, with nothing to attach', async () => {
    serve(request('submitted', [TEXT]))
    render(review([...WRITE, PLATFORM_PERMISSIONS.knowledgeReview]))

    const text = await screen.findByTestId('manifestation-text')
    expect(within(text).getByRole('link', { name: /oib-rl-1-2019\.pdf/ })).toHaveAttribute('href', '/api/knowledge-base/documents/oib-rl-1-2019.pdf')
    expect(within(text).getByRole('link', { name: 'fetched from www.oib.or.at' })).toHaveAttribute('href', TEXT.url)
    expect(within(text).getByText('12 pages')).toBeInTheDocument()
    // Submitted: no more records or texts go in.
    expect(within(text).queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument()
  })

  test('in a draft, an upload goes to the request with the manifestation’s key, and the request is read again', async () => {
    serve(request('draft', []))
    const user = userEvent.setup()
    render(review(WRITE))

    const text = await screen.findByTestId('manifestation-text')
    expect(within(text).getByText('No text attached yet.')).toBeInTheDocument()
    expect(within(text).getByText(/released with this request and indexed under Austria/)).toBeInTheDocument()

    const file = new File(['%PDF-1.7'], 'oib-rl-1-2019.pdf', { type: 'application/pdf' })
    await user.upload(within(text).getByTestId('manifestation-text-file'), file)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/texts/upload`, expect.objectContaining({ method: 'POST' })))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === `${BASE}/texts/upload`) as [string, RequestInit]
    const form = init.body as FormData
    expect(form.get('manifestationKey')).toBe('at-oib-rl-1-2019-text')
    expect((form.get('file') as File).name).toBe('oib-rl-1-2019.pdf')
    // The view is read again, so the attached text shows.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, call]) => url === BASE && !call).length).toBeGreaterThan(1))
  })

  test('in a draft, a URL on a configured source is sent to the request, never fetched by the browser', async () => {
    serve(request('draft', []))
    const user = userEvent.setup()
    render(review(WRITE))

    const text = await screen.findByTestId('manifestation-text')
    await user.click(within(text).getByRole('button', { name: 'Fetch from an address' }))
    await user.type(within(text).getByRole('textbox', { name: 'Source' }), 'at-oib')
    await user.type(within(text).getByRole('textbox', { name: 'Address of the PDF' }), TEXT.url)
    await user.click(within(text).getByRole('button', { name: 'Fetch' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE}/texts`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ manifestationKey: 'at-oib-rl-1-2019-text', sourceId: 'at-oib', url: TEXT.url }) }),
      ),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('oib.or.at'))).toBe(false)
  })

  test('read-only staff see the text of a draft and no way to attach one', async () => {
    serve(request('draft', []))
    render(review(READ))

    const text = await screen.findByTestId('manifestation-text')
    expect(within(text).getByText(/No text: this edition is listed only/)).toBeInTheDocument()
    expect(within(text).queryByRole('button')).not.toBeInTheDocument()
  })
})

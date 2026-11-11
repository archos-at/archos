import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { CountryKnowledge } from './country-knowledge'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

/** Who is looking: `u` wrote the fixture's request, anybody else did not. */
const viewer = vi.hoisted(() => ({ id: 'reviewer' }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: viewer.id } }) }))

/**
 * Platform → countries (ADR-0165): the countries and the queue from the real
 * routes' shapes; a request's next step asks before it runs, and read-only
 * staff get no write control.
 */

const OVERVIEW = {
  countries: [{ countryId: 'AT', released: { authority: 2, work: 3 }, openRequests: 1, entitledOffices: 4, overdueEditions: 1 }],
  queue: [{ id: 'cr-1', title: 'MA 37', countryId: 'AT', status: 'submitted', createdBy: 'u', createdAt: '2026-11-10T00:00:00Z', revisionCount: 1 }],
}

const REQUEST = {
  id: 'cr-1',
  title: 'MA 37',
  countryId: 'AT',
  status: 'submitted',
  createdBy: 'u',
  createdAt: '2026-11-10T00:00:00Z',
  submittedAt: '2026-11-10T00:00:00Z',
  publishedAt: null,
  approvals: [],
  releases: [],
  revisions: [
    {
      revisionId: 'r1',
      recordId: 'authority:at-wien-ma37',
      type: 'authority',
      createdBy: 'u',
      citations: [],
      claims: [{ path: 'competenceTerritoryIds', value: ['AT-9'], decision: null }],
    },
  ],
}

const fetchMock = vi.fn()

/** The routes as a stateful stand-in: a verdict the review route takes is on the request read next. */
function serve(overviewStatus = 200, request: typeof REQUEST & { captures?: unknown[] } = REQUEST) {
  let decision: string | null = null
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/platform/knowledge') {
      return overviewStatus === 200 ? Response.json(OVERVIEW) : new Response('{}', { status: overviewStatus })
    }
    if (init?.method === 'POST' && url.endsWith('/review')) {
      decision = JSON.parse(String(init.body)).decisions[0].decision
      return Response.json({ recorded: 1 })
    }
    if (init?.method === 'POST') return Response.json({ status: 'approved' })
    const [revision] = request.revisions
    return Response.json({ ...request, revisions: [{ ...revision, claims: revision.claims.map((claim) => ({ ...claim, decision })) }] })
  })
}

beforeEach(() => {
  viewer.id = 'reviewer'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const withPermissions = (permissions: string[]) => (
  <PlatformAccessProvider permissions={permissions}>
    <CountryKnowledge />
  </PlatformAccessProvider>
)

describe('CountryKnowledge', () => {
  test('lists each country with what it released, and the queue', async () => {
    serve()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    const countries = await screen.findByTestId('country-knowledge-countries')
    expect(within(countries).getByText('Austria')).toBeInTheDocument()
    expect(within(countries).getByText('2 authorities · 3 works')).toBeInTheDocument()
    expect(within(screen.getByTestId('country-knowledge-queue')).getByText('MA 37')).toBeInTheDocument()
  })

  test('reads the next page of drafts on request, and says so when the drafts cannot be read', async () => {
    serve()
    const draft = (id: string, title: string) => ({ ...OVERVIEW.queue[0], id, title, status: 'draft' })
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    const pages: Record<string, () => Response> = {
      '/api/platform/knowledge/change-requests?status=draft': () => Response.json({ changeRequests: [draft('cr-d1', 'OIB 2019')], nextCursor: '50' }),
      '/api/platform/knowledge/change-requests?status=draft&cursor=50': () => Response.json({ changeRequests: [draft('cr-d2', 'OIB 2023')], nextCursor: null }),
    }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => pages[url]?.() ?? routed(url, init))
    const user = userEvent.setup()
    const first = render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    const list = await screen.findByTestId('country-knowledge-drafts')
    expect(within(list).queryByText('OIB 2023')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more drafts' }))
    expect(await within(list).findByText('OIB 2023')).toBeInTheDocument()
    expect(within(list).getByText('OIB 2019')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more drafts' })).not.toBeInTheDocument()
    first.unmount()

    // A failed read is not "no drafts": the section says so and reads again on request.
    pages['/api/platform/knowledge/change-requests?status=draft'] = () => new Response('no', { status: 500 })
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    expect(await screen.findByText('The drafts could not be loaded')).toBeInTheDocument()
    pages['/api/platform/knowledge/change-requests?status=draft'] = () => Response.json({ changeRequests: [draft('cr-d1', 'OIB 2019')], nextCursor: null })
    await user.click(screen.getByRole('button', { name: /again/i }))
    expect(await within(await screen.findByTestId('country-knowledge-drafts')).findByText('OIB 2019')).toBeInTheDocument()
    expect(screen.queryByText('The drafts could not be loaded')).not.toBeInTheDocument()
  })

  test('says so when a refresh fails with drafts listed, and reads the first page again on request', async () => {
    serve()
    const draft = (id: string, title: string) => ({ ...OVERVIEW.queue[0], id, title, status: 'draft' })
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    const FIRST = '/api/platform/knowledge/change-requests?status=draft'
    const pages: Record<string, () => Response> = {
      [FIRST]: () => Response.json({ changeRequests: [draft('cr-d1', 'OIB 2019')], nextCursor: '50' }),
      [`${FIRST}&cursor=50`]: () => Response.json({ changeRequests: [draft('cr-d2', 'OIB 2023')], nextCursor: null }),
    }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => pages[url]?.() ?? routed(url, init))
    const draftReads = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(FIRST))
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    const list = await screen.findByTestId('country-knowledge-drafts')
    expect(within(list).getByText('OIB 2019')).toBeInTheDocument()

    // A verdict in the open request reads the page again, and this time the drafts do not answer.
    pages[FIRST] = () => new Response('no', { status: 500 })
    await user.click(within(screen.getByTestId('country-knowledge-queue')).getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'All correct' }))
    expect(await screen.findByText('The drafts could not be loaded')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('change-request-panel')).not.toBeInTheDocument())
    // What was listed stays, and the next page is not offered over a list that may be out of date.
    expect(within(list).getByText('OIB 2019')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more drafts' })).not.toBeInTheDocument()

    // Asking again repeats the read that failed, the first page, never the old cursor's next page.
    pages[FIRST] = () => Response.json({ changeRequests: [draft('cr-d3', 'OIB 2027')], nextCursor: null })
    const before = draftReads().length
    await user.click(screen.getByRole('button', { name: /again/i }))
    expect(await within(list).findByText('OIB 2027')).toBeInTheDocument()
    expect(draftReads().slice(before)).toEqual([FIRST])
    expect(within(list).queryByText('OIB 2019')).not.toBeInTheDocument()
    expect(screen.queryByText('The drafts could not be loaded')).not.toBeInTheDocument()
  })

  test('repeats a failed next page with the cursor it asked with', async () => {
    serve()
    const draft = (id: string, title: string) => ({ ...OVERVIEW.queue[0], id, title, status: 'draft' })
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    const FIRST = '/api/platform/knowledge/change-requests?status=draft'
    const pages: Record<string, () => Response> = {
      [FIRST]: () => Response.json({ changeRequests: [draft('cr-d1', 'OIB 2019')], nextCursor: '50' }),
      [`${FIRST}&cursor=50`]: () => new Response('no', { status: 500 }),
    }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => pages[url]?.() ?? routed(url, init))
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    const list = await screen.findByTestId('country-knowledge-drafts')
    await user.click(screen.getByRole('button', { name: 'Show more drafts' }))
    expect(await screen.findByText('The drafts could not be loaded')).toBeInTheDocument()
    expect(within(list).getByText('OIB 2019')).toBeInTheDocument()
    pages[`${FIRST}&cursor=50`] = () => Response.json({ changeRequests: [draft('cr-d2', 'OIB 2023')], nextCursor: null })
    await user.click(screen.getByRole('button', { name: 'Show more drafts' }))
    expect(await within(list).findByText('OIB 2023')).toBeInTheDocument()
    expect(within(list).getByText('OIB 2019')).toBeInTheDocument()
    expect(screen.queryByText('The drafts could not be loaded')).not.toBeInTheDocument()
  })

  test('lists the drafts, where texts are attached, and opens the one a link names', async () => {
    serve()
    const draft = { ...OVERVIEW.queue[0], id: 'cr-draft', title: 'OIB 2019', status: 'draft' }
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/platform/knowledge/change-requests?status=draft' ? Response.json({ changeRequests: [draft], nextCursor: null }) : routed(url, init),
    )
    window.history.replaceState(null, '', '?request=cr-1')
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    expect(within(await screen.findByTestId('country-knowledge-drafts')).getByText('OIB 2019')).toBeInTheDocument()
    // The base corpus links a file to its request with ?request=: it opens without a click.
    expect(await screen.findByTestId('change-request-panel')).toBeInTheDocument()
    window.history.replaceState(null, '', window.location.pathname)
  })

  test('says the caller has no access when the routes answer 403', async () => {
    serve(403)
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    expect(await screen.findByText('No access to platform knowledge')).toBeInTheDocument()
  })

  test('names the record and its fields in words, and says what to do now', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const record = await screen.findByTestId('change-request-record')
    expect(within(record).getByText('Authority')).toBeInTheDocument()
    expect(within(record).getByText('Decides for')).toBeInTheDocument()
    expect(within(record).getByText('Wien')).toBeInTheDocument()
    expect(within(record).queryByText('competenceTerritoryIds')).not.toBeInTheDocument()
    expect(screen.getByTestId('change-request-next')).toHaveTextContent('Check each entry against its source')
  })

  test('keeps approval closed until every entry is correct, then asks before approving', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText('Entries still to check: 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All correct' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/decision'), expect.anything())
    const dialog = await screen.findByRole('dialog', { name: 'Approve this change request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/decision',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'approve', role: 'domain_expert' }) }),
      ),
    )
  })

  test('offers to reject, not approve, a request with a wrong entry', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Not correct' }))
    expect(await screen.findByRole('button', { name: 'Reject request' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  test('shows read-only staff no write control', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await screen.findByTestId('change-request-panel')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument()
    expect(screen.getByText('not checked')).toBeInTheDocument()
  })

  test('shows the quote taken from a pasted page, and accepting it records that the source was checked', async () => {
    const pasted = {
      ...REQUEST,
      captures: [{ captureId: 'cap-1', changeRequestId: 'cr-1', basis: 'operator_supplied', sourceId: null, sourceOrigin: null, countsAsFetched: false, url: 'https://www.wien.gv.at/ma37', finalUrl: null, contentType: 'text/plain', sha256: 'a'.repeat(64), bytes: 9, textChars: 9, retrievedAt: '2026-11-10T00:00:00Z' }],
      revisions: [{ ...REQUEST.revisions[0], citations: [{ captureId: 'cap-1', quote: 'Magistratsabteilung 37' }] }],
    }
    serve(200, pasted as unknown as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const record = await screen.findByTestId('change-request-record')
    expect(within(record).getByText('Magistratsabteilung 37')).toBeInTheDocument()
    expect(within(record).getByText('pasted, not fetched')).toBeInTheDocument()
    await user.click(within(record).getByRole('button', { name: 'Checked against the source, all correct' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/review',
        expect.objectContaining({
          body: JSON.stringify({ decisions: [{ revisionId: 'r1', claimPath: 'competenceTerritoryIds', decision: 'accepted', sourceChecked: true }] }),
        }),
      ),
    )
  })

  test('a page fetched through a source nobody else reviewed is checked like a pasted one', async () => {
    const capture = { captureId: 'cap-1', changeRequestId: 'cr-1', basis: 'fetched', sourceId: 'xa-own', sourceOrigin: 'draft', countsAsFetched: false, url: 'https://attacker.example/law', finalUrl: null, contentType: 'text/html', sha256: 'a'.repeat(64), bytes: 9, textChars: 9, retrievedAt: '2026-11-10T00:00:00Z' }
    const fetched = { ...REQUEST, captures: [capture], revisions: [{ ...REQUEST.revisions[0], citations: [{ captureId: 'cap-1', quote: 'Magistratsabteilung 37' }] }] }
    serve(200, fetched as unknown as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const record = await screen.findByTestId('change-request-record')
    expect(within(record).getByText('fetched through an unreviewed source')).toBeInTheDocument()
    await user.click(within(record).getByRole('button', { name: 'Checked against the source, all correct' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/review',
        expect.objectContaining({
          body: JSON.stringify({ decisions: [{ revisionId: 'r1', claimPath: 'competenceTerritoryIds', decision: 'accepted', sourceChecked: true }] }),
        }),
      ),
    )
  })

  test('accepting a manifestation whose text was uploaded, or fetched through an unreviewed source, records that the text was checked; a fetched one does not', async () => {
    const text = { revisionId: 'r1', recordId: 'manifestation:oib-rl-1-2019-text', editionId: 'edition:oib-rl-1-2019', corpusFile: 'oib-rl-1-2019.pdf', sha256: 'a'.repeat(64), bytes: 9, pages: null, sourceId: null, url: null, attachedBy: 'u', attachedAt: '2026-11-10T00:00:00Z' }
    const withText = (origin: 'upload' | 'url', countsAsFetched = origin === 'url') => ({
      ...REQUEST,
      revisions: [{ ...REQUEST.revisions[0], recordId: text.recordId, type: 'manifestation', claims: [{ path: 'corpusFile', value: text.corpusFile, decision: null }] }],
      texts: [{ ...text, origin, countsAsFetched, sourceOrigin: origin === 'upload' ? null : countsAsFetched ? 'released' : 'draft', url: origin === 'url' ? 'https://www.oib.or.at/rl1.pdf' : null }],
    })
    const sent = (sourceChecked: boolean) =>
      expect.objectContaining({ body: JSON.stringify({ decisions: [{ revisionId: 'r1', claimPath: 'corpusFile', decision: 'accepted', sourceChecked }] }) })
    const user = userEvent.setup()

    serve(200, withText('upload') as unknown as typeof REQUEST)
    const first = render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const uploaded = await screen.findByTestId('change-request-record')
    expect(within(uploaded).getByText(/uploaded, or fetched through a source nobody else has reviewed/)).toBeInTheDocument()
    await user.click(within(uploaded).getByRole('button', { name: 'Checked against the source, all correct' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/platform/knowledge/change-requests/cr-1/review', sent(true)))
    first.unmount()

    // A text fetched through a source its own request proposed is held the same way (migration 0224).
    fetchMock.mockClear()
    serve(200, withText('url', false) as unknown as typeof REQUEST)
    const second = render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const unreviewed = await screen.findByTestId('change-request-record')
    expect(within(unreviewed).getByText('fetched through an unreviewed source')).toBeInTheDocument()
    await user.click(within(unreviewed).getByRole('button', { name: 'Checked against the source, all correct' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/platform/knowledge/change-requests/cr-1/review', sent(true)))
    second.unmount()

    // Positive control: a text the product fetched from a configured source asks for no such check.
    fetchMock.mockClear()
    serve(200, withText('url') as unknown as typeof REQUEST)
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const fetched = await screen.findByTestId('change-request-record')
    expect(within(fetched).queryByText(/uploaded, not fetched from a source/)).not.toBeInTheDocument()
    await user.click(within(fetched).getByRole('button', { name: 'All correct' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/platform/knowledge/change-requests/cr-1/review', sent(false)))
  })

  test('offers the author an approval alone only with the permission, and asks for a reason first (ADR-0176)', async () => {
    viewer.id = 'u'
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAlone]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Approve without a second review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve without a second review?' })
    const confirm = within(dialog).getByRole('button', { name: 'Approve without a second review' })
    expect(confirm).toBeDisabled()
    const reason = 'Nobody else on the platform team this week.'
    await user.type(within(dialog).getByTestId('approve-alone-reason'), reason)
    await user.click(confirm)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/decision',
        expect.objectContaining({ body: JSON.stringify({ decision: 'approve', role: 'domain_expert', override: { reason } }) }),
      ),
    )
  })

  test('offers no approval alone to an author without the permission', async () => {
    viewer.id = 'u'
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
  })

  test('marks a request approved alone, and lets another person confirm or dispute its second review', async () => {
    serve(200, {
      ...REQUEST,
      status: 'published',
      approval: 'single',
      secondReview: { state: 'due', by: null, at: null },
      secondReviewRoles: [
        { role: 'counsel', state: 'due', by: null, at: null },
        { role: 'domain_expert', state: 'due', by: null, at: null },
      ],
    } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    const badges = await screen.findByTestId('approval-badges')
    expect(badges).toHaveTextContent('Approved without a second review')
    expect(badges).toHaveTextContent('Second review due')
    expect(screen.getByTestId('second-review-roles')).toHaveTextContent('Second review due as: counsel, domain expert')
    expect(screen.getByTestId('second-review-confirm')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'All correct' }))
    await waitFor(() => expect(screen.getByTestId('second-review-confirm')).toBeEnabled())
    await user.click(screen.getByTestId('second-review-dispute'))
    const dialog = await screen.findByRole('dialog', { name: 'Dispute the approval?' })
    await user.click(within(dialog).getByRole('button', { name: 'Dispute' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/decision',
        expect.objectContaining({ body: JSON.stringify({ decision: 'reject', role: 'domain_expert' }) }),
      ),
    )
  })

  test('gives the second review in the due role the reviewer holds, and offers it to nobody who holds none', async () => {
    serve(200, {
      ...REQUEST,
      status: 'approved',
      approval: 'single',
      secondReview: { state: 'due', by: null, at: null },
      secondReviewRoles: [{ role: 'counsel', state: 'due', by: null, at: null }],
    } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await screen.findByTestId('second-review-roles')
    expect(screen.queryByTestId('second-review-dispute')).not.toBeInTheDocument()
  })

  test('offers to reject an approved request whose second review disputed it, and no publish', async () => {
    serve(200, { ...REQUEST, status: 'approved', approval: 'single', secondReview: { state: 'disputed', by: 'x', at: '2026-11-10T00:00:00Z' } } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByTestId('change-request-step-reject')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Publish to preview' })).not.toBeInTheDocument()
  })

  test('offers no approval alone while a pasted page is unchecked: another person checks it first (migration 0218)', async () => {
    viewer.id = 'u'
    serve(200, { ...REQUEST, sourcesUnchecked: true } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAlone]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'All correct' }))
    // Every entry correct, and still neither an approval alone nor a plain approve, which four eyes would refuse.
    await screen.findByText(/another person approves it/)
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  test('offers no approval alone once the request is approved as domain expert', async () => {
    viewer.id = 'u'
    serve(200, { ...REQUEST, approvals: [{ approver: 'u', role: 'domain_expert', decisionSource: 'app', decidedAt: '2026-11-10T00:00:00Z', overrideReason: 'x'.repeat(25) }] } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAlone]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await screen.findByTestId('change-request-next')
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
  })
})

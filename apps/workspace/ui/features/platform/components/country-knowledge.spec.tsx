import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { CountryKnowledge } from './country-knowledge'
import { CountryPage } from './countries/country-page'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

/** Who is looking: `u` wrote the fixture's request, anybody else did not. */
const viewer = vi.hoisted(() => ({ id: 'reviewer' }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: viewer.id } }) }))

/**
 * Platform → Länder (ADR-0165): the list of countries with their stage and next
 * step, one country's page with each section and its empty state, all from the
 * real routes' shapes; a request opened from the review section asks before its
 * next step runs, and read-only staff get no write control.
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
    if (url.startsWith('/api/platform/knowledge/change-requests?')) return Response.json({ changeRequests: OVERVIEW.queue, nextCursor: null })
    if (url.startsWith('/api/platform/knowledge/texts')) return Response.json({ texts: [], nextCursor: null })
    if (url === '/api/platform/knowledge/sources') return Response.json({ sources: [], builtInUnavailable: null })
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
  // The review section of the country page, where a request opens.
  window.history.replaceState(null, '', '?section=review')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const withPermissions = (permissions: string[]) => (
  <PlatformAccessProvider permissions={permissions}>
    <CountryPage countryId="AT" />
  </PlatformAccessProvider>
)

describe('CountryKnowledge', () => {
  test('lists each country with its stage and the one thing it needs, linking to its page', async () => {
    serve()
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
        <CountryKnowledge />
      </PlatformAccessProvider>,
    )
    const row = await screen.findByTestId('country-row-AT')
    expect(within(row).getByRole('link', { name: 'Austria' })).toHaveAttribute('href', '/app/platform/countries/AT')
    expect(within(row).getByText('Published')).toBeInTheDocument()
    expect(within(row).getByText('Review 1 request')).toBeInTheDocument()
  })

  test('opens the request a link names on the list', async () => {
    serve()
    window.history.replaceState(null, '', '?request=cr-1')
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
        <CountryKnowledge />
      </PlatformAccessProvider>,
    )
    expect(await screen.findByTestId('change-request-panel')).toBeInTheDocument()
  })

  test('a country page starts on its overview with the next step, and each section says what to do when empty', async () => {
    serve()
    window.history.replaceState(null, '', '/')
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    expect(await screen.findByTestId('country-next-step')).toHaveTextContent('A change request waits for your review')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByTestId('country-review-waiting')).toHaveTextContent('MA 37')
    await user.click(screen.getByRole('tab', { name: 'Works and editions' }))
    expect(await screen.findByText('No texts yet')).toBeInTheDocument()
    // With no draft open, a person still adds a document: the dialog opens one (add-document-dialog.spec.tsx).
    expect(screen.getByRole('button', { name: 'Add a document' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Sources' }))
    expect(await screen.findByText('No source yet')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Rules' }))
    expect(await screen.findByText('No rules yet')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Quality' }))
    expect(await screen.findByText('No test questions yet')).toBeInTheDocument()
  })

  test('lists a country’s texts by work and edition, and a draft to attach one in', async () => {
    serve()
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    const text = (corpusFile: string, released: boolean) => ({
      corpusFile,
      countryId: 'AT',
      recordId: `manifestation:${corpusFile}`,
      editionId: 'edition:rl-1-2019',
      editionLabel: '2019',
      workTitle: 'Mechanische Festigkeit',
      released,
      changeRequestId: released ? null : 'cr-draft',
      changeRequestTitle: released ? null : 'Texts 2019',
      changeRequestStatus: released ? null : 'draft',
    })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/platform/knowledge/texts?countryId=AT') return Response.json({ texts: [text('a.pdf', true), text('b.pdf', false)], nextCursor: null })
      if (url.startsWith('/api/platform/knowledge/change-requests?countryId=AT')) {
        return Response.json({ changeRequests: [{ ...OVERVIEW.queue[0], id: 'cr-draft', title: 'Texts 2019', status: 'draft' }], nextCursor: null })
      }
      return routed(url, init)
    })
    window.history.replaceState(null, '', '?section=works')
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    const works = await screen.findByTestId('country-works')
    expect(within(works).getAllByText('Mechanische Festigkeit')).toHaveLength(1)
    expect(within(works).getByText('Published')).toBeInTheDocument()
    expect(within(works).getByRole('button', { name: 'Draft' })).toBeInTheDocument()
    expect(within(screen.getByTestId('country-works-drafts')).getByRole('button', { name: 'Attach a text' })).toBeInTheDocument()
  })

  test('accepts every open claim of a waiting request in one decision, only once the person says the sources were checked', async () => {
    serve()
    const routed = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith('/review/accept-all') ? Response.json({ accepted: 3010, records: 430, alreadyDecided: 0, sourceChecked: true }) : routed(url, init),
    )
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    const waiting = await screen.findByTestId('country-review-waiting')
    await user.click(within(waiting).getByRole('button', { name: 'Accept all open claims' }))
    const dialog = await screen.findByRole('dialog', { name: 'Accept every open claim?' })
    const confirm = within(dialog).getByRole('button', { name: 'Accept all open claims' })
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(confirm)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform/knowledge/change-requests/cr-1/review/accept-all',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ sourceChecked: true }) }),
      ),
    )
    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalledWith('Accepted 3010 claims in 430 records.')
  })

  test('offers accepting every open claim only to a reviewer', async () => {
    serve()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    const waiting = await screen.findByTestId('country-review-waiting')
    expect(within(waiting).queryByRole('button', { name: 'Accept all open claims' })).not.toBeInTheDocument()
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
    window.history.replaceState(null, '', '?section=review')

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
    window.history.replaceState(null, '', '?section=review')

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

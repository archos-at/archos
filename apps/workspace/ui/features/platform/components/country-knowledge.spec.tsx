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
      captures: [{ captureId: 'cap-1', changeRequestId: 'cr-1', basis: 'operator_supplied', sourceId: null, url: 'https://www.wien.gv.at/ma37', finalUrl: null, contentType: 'text/plain', sha256: 'a'.repeat(64), bytes: 9, textChars: 9, retrievedAt: '2026-11-10T00:00:00Z' }],
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

  test('offers no approval alone while a pasted page is unchecked: another person checks it first (migration 0216)', async () => {
    viewer.id = 'u'
    serve(200, { ...REQUEST, sourcesUnchecked: true } as typeof REQUEST)
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeApproveAlone]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await screen.findByTestId('change-request-next')
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
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

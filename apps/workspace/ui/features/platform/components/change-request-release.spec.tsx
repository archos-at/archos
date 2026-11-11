import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { ChangeRequestView } from '@/lib/base-knowledge/platform/wire'
import { ReleaseBar } from './change-request-release'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

/** Who is looking: `u` wrote the fixture's request, anybody else did not. */
const viewer = vi.hoisted(() => ({ id: 'reviewer' }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: viewer.id } }) }))

/**
 * The step after the verdicts (ADR-0165, ADR-0176), as the law map ends with
 * it: approve once every claim is correct, reject a request with a wrong one,
 * approve alone only with the permission and a reason, and give or dispute a
 * due second review in a role the reviewer holds. Each asks first; four eyes
 * stays the server's.
 */

const DECISION = '/api/platform/knowledge/change-requests/cr-1/decision'

const view = (decision: 'accepted' | 'rejected' | null, extra: Partial<ChangeRequestView> = {}): ChangeRequestView =>
  ({
    id: 'cr-1',
    title: 'Guide 1',
    countryId: 'XA',
    status: 'submitted',
    createdBy: 'u',
    createdAt: '2026-11-10T00:00:00Z',
    submittedAt: '2026-11-10T00:00:00Z',
    publishedAt: null,
    approval: 'four_eyes',
    secondReview: null,
    secondReviewRoles: [],
    approvals: [],
    releases: [],
    captures: [],
    texts: [],
    sourcesUnchecked: false,
    revisions: [{ revisionId: 'r1', recordId: 'authority:xa-office', type: 'authority', createdBy: 'u', citations: [], claims: [{ path: 'name', value: 'Office', decision }] }],
    ...extra,
  }) as unknown as ChangeRequestView

const fetchMock = vi.fn()
const REVIEW = [PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]

function bar(shown: ChangeRequestView, permissions: string[], onChanged = vi.fn()) {
  render(
    <PlatformAccessProvider permissions={permissions}>
      <ReleaseBar view={shown} canManage={permissions.includes(PLATFORM_PERMISSIONS.knowledgeReview)} onChanged={onChanged} />
    </PlatformAccessProvider>,
  )
  return onChanged
}

beforeEach(() => {
  viewer.id = 'reviewer'
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ status: 'approved' }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('ReleaseBar', () => {
  test('keeps approval closed while an entry is unchecked', () => {
    bar(view(null), REVIEW)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText('Entries still to check: 1')).toBeInTheDocument()
  })

  test('asks before approving a request whose every entry is correct, then tells the page', async () => {
    const user = userEvent.setup()
    const onChanged = bar(view('accepted'), REVIEW)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(fetchMock).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'Approve this change request?' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(DECISION, expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'approve', role: 'domain_expert' }) })))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  test('offers to reject, not approve, a request with a wrong entry', () => {
    bar(view('rejected'), REVIEW)
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  test('shows read-only staff no step', () => {
    bar(view('accepted'), [PLATFORM_PERMISSIONS.settingsView])
    expect(screen.queryByTestId('release-bar')).not.toBeInTheDocument()
  })

  test('offers the author an approval alone only with the permission, and asks for a reason first (ADR-0176)', async () => {
    viewer.id = 'u'
    const user = userEvent.setup()
    bar(view('accepted'), [...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAlone])
    await user.click(screen.getByRole('button', { name: 'Approve without a second review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve without a second review?' })
    const confirm = within(dialog).getByRole('button', { name: 'Approve without a second review' })
    expect(confirm).toBeDisabled()
    const reason = 'Nobody else on the platform team this week.'
    await user.type(within(dialog).getByTestId('approve-alone-reason'), reason)
    await user.click(confirm)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(DECISION, expect.objectContaining({ body: JSON.stringify({ decision: 'approve', role: 'domain_expert', override: { reason } }) })))
  })

  test('offers no approval alone to an author without the permission, and no approve four eyes would refuse', () => {
    viewer.id = 'u'
    bar(view('accepted'), REVIEW)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
  })

  test('offers no approval alone while a pasted page is unchecked: another person checks it first (migration 0218)', () => {
    viewer.id = 'u'
    bar(view('accepted', { sourcesUnchecked: true }), [...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAlone])
    expect(screen.getByText(/another person approves it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  test('offers no approval alone once the request is approved as domain expert', () => {
    viewer.id = 'u'
    const approvals = [{ approver: 'u', role: 'domain_expert', decisionSource: 'app', decidedAt: '2026-11-10T00:00:00Z', overrideReason: 'x'.repeat(25) }]
    bar(view('accepted', { approvals } as Partial<ChangeRequestView>), [...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAlone])
    expect(screen.queryByRole('button', { name: 'Approve without a second review' })).not.toBeInTheDocument()
  })

  test('lets another person confirm or dispute a due second review, once every entry is correct', async () => {
    const due = (decision: 'accepted' | null) =>
      view(decision, {
        status: 'published',
        approval: 'single',
        secondReview: { state: 'due', by: null, at: null },
        secondReviewRoles: [
          { role: 'counsel', state: 'due', by: null, at: null },
          { role: 'domain_expert', state: 'due', by: null, at: null },
        ],
      } as Partial<ChangeRequestView>)
    const permissions = [...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert]
    const first = render(
      <PlatformAccessProvider permissions={permissions}>
        <ReleaseBar view={due(null)} canManage onChanged={vi.fn()} />
      </PlatformAccessProvider>,
    )
    expect(screen.getByTestId('second-review-confirm')).toBeDisabled()
    first.unmount()

    const user = userEvent.setup()
    bar(due('accepted'), permissions)
    expect(screen.getByTestId('second-review-confirm')).toBeEnabled()
    await user.click(screen.getByTestId('second-review-dispute'))
    const dialog = await screen.findByRole('dialog', { name: 'Dispute the approval?' })
    await user.click(within(dialog).getByRole('button', { name: 'Dispute' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(DECISION, expect.objectContaining({ body: JSON.stringify({ decision: 'reject', role: 'domain_expert' }) })))
  })

  test('offers the second review to nobody who holds none of its due roles', () => {
    bar(
      view('accepted', { status: 'approved', approval: 'single', secondReview: { state: 'due', by: null, at: null }, secondReviewRoles: [{ role: 'counsel', state: 'due', by: null, at: null }] } as Partial<ChangeRequestView>),
      [...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert],
    )
    expect(screen.queryByTestId('second-review-dispute')).not.toBeInTheDocument()
  })

  test('offers to reject an approved request whose second review disputed it, and no publish', () => {
    bar(view('accepted', { status: 'approved', approval: 'single', secondReview: { state: 'disputed', by: 'x', at: '2026-11-10T00:00:00Z' } } as Partial<ChangeRequestView>), REVIEW)
    expect(screen.getByTestId('change-request-step-reject')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Publish to preview' })).not.toBeInTheDocument()
  })
})

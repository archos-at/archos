import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { LawMapPage } from './law-map-page'

const navigation = vi.hoisted(() => ({ search: '', replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace, push: navigation.push, refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: 'reviewer' } }) }))

/**
 * The law map as the one surface for a change request (country-onboarding-ux.md, B): it says where the request
 * stands and how it was approved, shows every entry a confirmation covers, lets a confirmed one be sent back,
 * gives a text for an already released edition its own row to attach in, and lands a link on the right map.
 */

const ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const BASE = '/api/platform/knowledge/change-requests'

const revision = (type: string, recordId: string, body: Record<string, unknown>, decision: 'accepted' | null = null) => ({
  revisionId: `rev-${recordId}`,
  recordId,
  type,
  createdBy: 'author',
  citations: [{ url: 'https://gazette.xa.example/1', quote: 'the words on the page' }],
  claims: Object.entries(body).map(([path, value]) => ({ path, value, decision })),
})

const REVISIONS = [
  revision('territory', 'XA', { kind: 'country', name: 'Xanadu', parents: [] }, 'accepted'),
  revision('territory', 'XA-1', { kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] }, 'accepted'),
  revision('manifestation', 'manifestation:mc-2-2015-text', { editionId: 'edition:mc-2-2015', corpusFile: null, licenceClass: 'public_domain' }),
]

const view = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  title: 'Xanadu',
  countryId: 'XA',
  status: 'submitted',
  createdBy: 'author',
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
  revisions: REVISIONS,
  ...extra,
})

const fetchMock = vi.fn()

function serve(shown: ReturnType<typeof view>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith(`${BASE}?`)) return Response.json({ changeRequests: [{ id: ID, title: shown.title, status: shown.status, countryId: shown.countryId, createdAt: shown.createdAt }], nextCursor: null })
    if (url === '/api/platform/knowledge/sources') return Response.json({ sources: [], builtInUnavailable: null })
    return Response.json(shown)
  })
}

const page = (permissions: string[]) =>
  render(
    <PlatformAccessProvider permissions={permissions}>
      <LawMapPage countryId="XA" today="2026-11-11" />
    </PlatformAccessProvider>,
  )

const REVIEW = [PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]

beforeEach(() => {
  navigation.search = `request=${ID}`
  navigation.replace.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('LawMapPage', () => {
  test('says where the request stands: its status, its progress, and how it was approved', async () => {
    serve(view({ status: 'published', approval: 'single', secondReview: { state: 'due', by: null, at: null }, secondReviewRoles: [{ role: 'counsel', state: 'due', by: null, at: null }] }))
    page([...REVIEW, PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert])
    expect(await screen.findByText('From the change request "Xanadu" · Published')).toBeInTheDocument()
    expect(screen.getByTestId('law-map-progress')).toHaveTextContent('6 of 9 entries confirmed')
    expect(screen.getByTestId('approval-state')).toHaveTextContent('Approved without a second review · Second review due · Second review due as: counsel')
    // A reviewer who holds no due role is told why there is nothing to give.
    expect(screen.getByTestId('release-bar')).toHaveTextContent('you hold none of these roles')
  })

  test('shows every entry a confirmation covers, with its fields in words and its source', async () => {
    serve(view())
    const user = userEvent.setup()
    page(REVIEW)
    await user.click(await screen.findByTestId('loose-texts'))
    await user.click(screen.getByRole('button', { name: /mc-2-2015-text/ }))
    await user.click(screen.getByTestId('entries-text:manifestation:mc-2-2015-text'))
    const entry = screen.getByTestId('entry-manifestation:mc-2-2015-text')
    expect(within(entry).getByText('Licence')).toBeInTheDocument()
    expect(within(entry).getByText('public_domain')).toBeInTheDocument()
    expect(within(entry).getByText('the words on the page')).toBeInTheDocument()
  })

  test('in a draft, a text for an edition already released is attached in its own row', async () => {
    serve(view({ status: 'draft' }))
    const user = userEvent.setup()
    page([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeWrite])
    await user.click(await screen.findByTestId('loose-texts'))
    await user.click(screen.getByRole('button', { name: /mc-2-2015-text/ }))
    expect(within(screen.getByTestId('manifestation-text')).getByRole('button', { name: /Upload/ })).toBeInTheDocument()
  })

  test('lets a reviewer send a confirmed unit back while the request is open', async () => {
    serve(view())
    const user = userEvent.setup()
    page(REVIEW)
    await user.click(await screen.findByRole('button', { name: /Xanadu/, expanded: false }))
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Something is wrong' }))
    await user.type(screen.getByRole('textbox'), 'Nordland lies in another country')
    await user.click(screen.getByRole('button', { name: /Send back/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/${ID}/review`, expect.objectContaining({ method: 'POST', body: expect.stringContaining('"decision":"rejected"') })))
  })

  test('says so when a link names no change request', async () => {
    navigation.search = 'request=not-a-request'
    serve(view())
    page(REVIEW)
    expect(await screen.findByText(/does not name a change request/)).toBeInTheDocument()
  })

  test('draws a request on its own country’s map', async () => {
    serve(view({ countryId: 'XB' }))
    page(REVIEW)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(`/app/platform/countries/xb/map?request=${ID}`))
  })
})

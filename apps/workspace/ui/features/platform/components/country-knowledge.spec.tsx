import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { CountryKnowledge } from './country-knowledge'
import { CountryPage } from './countries/country-page'

const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}))

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
  push.mockReset()
  replace.mockReset()
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

  test('a tap anywhere on a row opens that row’s country, not the last row’s (no link stretched over a table row)', async () => {
    serve()
    push.mockClear()
    const user = userEvent.setup()
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
        <CountryKnowledge />
      </PlatformAccessProvider>,
    )
    const row = await screen.findByTestId('country-row-AT')
    expect(within(row).getByRole('link', { name: 'Austria' }).className).not.toMatch(/after:absolute/)
    await user.click(within(row).getByText('Published'))
    expect(push).toHaveBeenCalledWith('/app/platform/countries/AT')
  })

  test('sends a link that names a request on the list to that request on its country’s law map', async () => {
    serve()
    window.history.replaceState(null, '', '?request=0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e')
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
        <CountryKnowledge />
      </PlatformAccessProvider>,
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/platform/countries/at/map?request=0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'))
  })

  test('opens a request from the review section on the law map, where it is reviewed and released', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview]))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(push).toHaveBeenCalledWith('/app/platform/countries/at/map?request=cr-1')
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

  test('says the caller has no access when the routes answer 403', async () => {
    serve(403)
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    expect(await screen.findByText('No access to platform knowledge')).toBeInTheDocument()
  })
})

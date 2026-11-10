import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { CountryKnowledge } from './country-knowledge'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

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

function serve(overviewStatus = 200) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/platform/knowledge') {
      return overviewStatus === 200 ? Response.json(OVERVIEW) : new Response('{}', { status: overviewStatus })
    }
    if (init?.method === 'POST') return Response.json({ status: 'approved' })
    return Response.json(REQUEST)
  })
}

beforeEach(() => {
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
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.settingsManage]))
    const countries = await screen.findByTestId('country-knowledge-countries')
    expect(within(countries).getByText('AT')).toBeInTheDocument()
    expect(within(countries).getByText('2 authorities · 3 works')).toBeInTheDocument()
    expect(within(screen.getByTestId('country-knowledge-queue')).getByText('MA 37')).toBeInTheDocument()
  })

  test('says platform knowledge is off when the routes answer 403', async () => {
    serve(403)
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    expect(await screen.findByText('Platform knowledge is not switched on')).toBeInTheDocument()
  })

  test('asks before approving, and approves only on the yes', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.settingsManage]))
    await user.click(await screen.findByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
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

  test('shows read-only staff no write control', async () => {
    serve()
    const user = userEvent.setup()
    render(withPermissions([PLATFORM_PERMISSIONS.settingsView]))
    await user.click(await screen.findByRole('button', { name: 'Open' }))
    await screen.findByTestId('change-request-panel')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept this claim' })).not.toBeInTheDocument()
  })
})

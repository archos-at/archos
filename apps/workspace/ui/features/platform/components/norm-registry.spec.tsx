import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { NormRegistry } from './norm-registry'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

/**
 * What these tests pin is the persistence contract as much as the chrome: the
 * whole catalog is written at once under the version we loaded, so a 409 must
 * take Save away until the user has actually seen the current registry.
 */

const WIEN = {
  id: 'bauo-wien',
  title: 'Bauordnung für Wien',
  short: 'BO Wien',
  rank: 'state_law',
  federal_state: 'Wien',
  topics: ['Bewilligung'],
  relevance: 'hoch',
  application: 'LrW',
  document_number: 'LrW40009876',
  source_url: '',
  citation_url: 'https://ris.example/LrW40009876',
  full_law_url: '',
  aliases: ['Wiener Bauordnung'],
  review_note: 'Novelle 2026 einarbeiten',
  verify: { title_query: 'Bauordnung für Wien', exclude: [] },
  verified_at: '2026-05-01',
}

const OIB = {
  id: 'oib-rl2-2023',
  title: 'OIB-Richtlinie 2 — Brandschutz',
  short: 'OIB-RL 2',
  rank: 'ordinance',
  federal_state: '',
  topics: ['Brandschutz'],
  relevance: 'hoch',
  application: 'BrKons',
  document_number: 'NOR40251234',
  source_url: '',
  citation_url: 'https://ris.example/NOR40251234',
  full_law_url: '',
  aliases: [],
  verify: { title_query: 'OIB-Richtlinie 2', exclude: [] },
  verified_at: '2026-06-01',
}

const MERKBLATT = {
  id: 'ma37-fluchtwege',
  title: 'MA 37 — Merkblatt Fluchtwege',
  short: 'MA 37 FW',
  rank: 'authority_info',
  federal_state: 'Wien',
  topics: ['Fluchtwege'],
  relevance: 'mittel',
  application: '',
  document_number: '',
  source_url: 'https://www.wien.gv.at/merkblatt',
  citation_url: '',
  full_law_url: '',
  aliases: [],
  verified_at: '',
}

const ENVELOPE = {
  version: 7,
  registry: {
    version: 1,
    corpus_collection: 'oib_knowledge',
    language: 'de',
    states: { W: 'Wien' },
    corpus_note: 'Nur konsolidierte Fassungen.',
    doctrine: 'AT',
    parcel_tags: ['grundstueck'],
    entries: [WIEN, OIB, MERKBLATT],
  },
}

const VERIFY_RESULT = {
  candidates: [
    {
      title: 'Bauordnung für Wien — Fassung 2026',
      document_number: 'LrW40011223',
      citation_url: 'https://ris.example/LrW40011223',
      full_law_url: 'https://ris.example/full/LrW',
    },
  ],
  verified_at: '2026-07-28',
}

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

/** One spy routing GET / PUT / verify, so a test only states what differs. */
function stubFetch(options: { put?: { status: number; body?: unknown }; verify?: unknown } = {}) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/platform/norms/verify')) {
      return json(options.verify ?? VERIFY_RESULT)
    }
    if (init?.method === 'PUT') {
      const put = options.put ?? { status: 200, body: { version: 8 } }
      return json(put.body ?? {}, put.status)
    }
    return json(ENVELOPE)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

// Radix leaves `pointer-events: none` on the body for a tick after a
// sheet/dialog closes; the checks would fail clicks the user can really make.
const user = () => userEvent.setup({ pointerEventsCheck: 0 })

const putCalls = (spy: ReturnType<typeof stubFetch>) =>
  spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')

describe('NormRegistry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('lists the catalog with rank, scope, document and verification signals', async () => {
    stubFetch()

    render(<NormRegistry />)

    expect(await screen.findByText('Bauordnung für Wien')).toBeDefined()
    expect(screen.getByText('OIB-Richtlinie 2 — Brandschutz')).toBeDefined()
    expect(screen.getByText('3 entries')).toBeDefined()

    // Federal law and a state act are told apart by the scope column.
    expect(screen.getAllByText('Federal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Wien').length).toBeGreaterThan(0)

    // RIS pointer vs. a plain source link vs. nothing at all.
    expect(screen.getByText('LrW · LrW40009876')).toBeDefined()
    expect(screen.getByText('www.wien.gv.at')).toBeDefined()

    // A missing verified_at is stale, not blank.
    expect(screen.getByText('unverified')).toBeDefined()
    expect(screen.getByText('2026-05-01')).toBeDefined()
  })

  test('surfaces a retryable error instead of a permanent skeleton', async () => {
    const spy = vi.fn().mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json(ENVELOPE))
    vi.stubGlobal('fetch', spy)

    render(<NormRegistry />)

    expect(await screen.findByText('Could not load the norm catalog.')).toBeDefined()

    await user().click(screen.getByRole('button', { name: /Try again/i }))

    expect(await screen.findByText('Bauordnung für Wien')).toBeDefined()
  })

  test('filters by search and by the open-review queue', async () => {
    stubFetch()

    render(<NormRegistry />)
    await screen.findByText('Bauordnung für Wien')

    await user().type(screen.getByLabelText('Search norm entries'), 'brandschutz')

    expect(screen.getByText('OIB-Richtlinie 2 — Brandschutz')).toBeDefined()
    expect(screen.queryByText('Bauordnung für Wien')).toBeNull()

    await user().click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await screen.findByText('Bauordnung für Wien')).toBeDefined()

    // The review queue survived the rebuild as a filter — count included.
    await user().click(screen.getByRole('button', { name: 'Open reviews (1)' }))
    expect(screen.getByText('Bauordnung für Wien')).toBeDefined()
    expect(screen.queryByText('OIB-Richtlinie 2 — Brandschutz')).toBeNull()
  })

  test('says so when the filters match nothing, rather than showing a blank table', async () => {
    stubFetch()

    render(<NormRegistry />)
    await screen.findByText('Bauordnung für Wien')

    await user().type(screen.getByLabelText('Search norm entries'), 'salzburg')

    expect(screen.getByText('No entry matches these filters')).toBeDefined()
  })

  test('is read-only for every member, managers too, and points to change requests (ADR-0175)', async () => {
    const spy = stubFetch()
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.settingsManage]}>
        <NormRegistry />
      </PlatformAccessProvider>
    )

    expect(await screen.findByText('Bauordnung für Wien')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save registry' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
    expect(screen.getByTestId('norm-registry-retired')).toHaveTextContent('reviewed change request')
    expect(screen.getByRole('link', { name: 'Open country knowledge' })).toHaveAttribute('href', '/app/platform/countries')

    // The entry still opens: the source, rank and scope are what support staff
    // need to answer "why was this cited?". Nothing in it can change.
    await userEvent.click(screen.getByRole('button', { name: /Bauordnung für Wien/ }))
    const sheet = await screen.findByRole('dialog')
    for (const input of within(sheet).queryAllByRole('textbox')) expect(input).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: /Apply|Übernehmen/ })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(putCalls(spy)).toHaveLength(0)
  })

  test('the card is titled by its entry count, not by the page title, and the table has no second frame', async () => {
    stubFetch()
    render(<NormRegistry />)

    expect(await screen.findByText('3 entries')).toBeDefined()
    expect(screen.queryByText('Norm catalog')).toBeNull()
    expect(screen.getByRole('table').closest('.rounded-lg.border:not([data-slot=card])')).toBeNull()
  })

  test('on a phone the rank and scope ride under the title', async () => {
    stubFetch()
    render(<NormRegistry />)

    const row = (await screen.findByText('Bauordnung für Wien')).closest('tr') as HTMLElement
    // The scope column is hidden below `md`; the same fact is in the norm cell.
    const cells = within(row).getAllByRole('cell')
    expect(cells[0].textContent).toContain('Wien')
    expect(cells[2].className).toContain('hidden')
  })
})

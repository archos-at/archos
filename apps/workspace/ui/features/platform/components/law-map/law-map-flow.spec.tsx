import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { LawMapPage } from './law-map-page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`request=${ID}`),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
// The person who proposed the records, as on dev where one operator does it all.
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: { id: 'author' } }) }))

/**
 * The owner's path on dev, end to end in the law map and nowhere else: confirm every unit (ticking the source
 * check where a page was pasted), approve alone with a reason, publish to preview, publish to stable. The server
 * here is a stand-in that keeps state the way the routes do on a deployment that runs one operator alone.
 */

const ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const BASE = `/api/platform/knowledge/change-requests/${ID}`

const revision = (type: string, recordId: string, body: Record<string, unknown>, captureId?: string) => ({
  revisionId: `rev-${recordId}`,
  recordId,
  type,
  createdBy: 'author',
  citations: [captureId ? { captureId, quote: 'the words on the page' } : { url: 'https://gazette.xa.example/1', quote: 'the words on the page' }],
  claims: Object.entries(body).map(([path, value]) => ({ path, value, decision: null as string | null })),
})

function server() {
  const state = {
    status: 'submitted',
    approval: 'four_eyes',
    approvals: [] as unknown[],
    releases: [] as { channel: string; action: string }[],
    sourceChecked: false,
    revisions: [
      revision('territory', 'XA', { kind: 'country', name: 'Xanadu', parents: [] }),
      revision('territory', 'XA-1', { kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] }),
      revision('work', 'work:to-n', { kind: 'ordinance', title: 'Technical Ordinance Nordland', territoryIds: ['XA-1'] }, 'pasted'),
      revision('work', 'work:mc-2', { kind: 'model_code', title: 'Fire', identifiers: { designation: 'MC 2' }, territoryIds: ['XA'] }),
      revision('edition', 'edition:mc-2-2023', { workId: 'work:mc-2', label: 'Edition 2023' }),
      revision('relation', 'relation:n-2-23', { relationType: 'makes_binding', mode: 'declared', fromId: 'work:to-n', fromType: 'work', toId: 'edition:mc-2-2023', toType: 'edition', validFrom: '2024-03-01' }, 'pasted'),
    ],
  }
  const view = () => ({
    id: ID,
    title: 'Xanadu',
    countryId: 'XA',
    status: state.status,
    createdBy: 'author',
    createdAt: '2026-11-10T00:00:00Z',
    submittedAt: '2026-11-10T00:00:00Z',
    publishedAt: null,
    approval: state.approval,
    secondReview: null,
    secondReviewRoles: [],
    approvals: state.approvals,
    releases: state.releases,
    texts: [],
    captures: [{ captureId: 'pasted', changeRequestId: ID, basis: 'operator_supplied', sourceId: null, sourceOrigin: null, countsAsFetched: false, url: 'https://gazette.xa.example/lgbl/2024/9', finalUrl: null, contentType: 'text/plain', sha256: 'a'.repeat(64), bytes: 9, textChars: 9, pages: null, note: null, retrievedAt: '2026-11-10T00:00:00Z' }],
    sourcesUnchecked: !state.sourceChecked,
    revisions: state.revisions,
  })
  const calls: { path: string; body: Record<string, unknown> }[] = []
  return {
    state,
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/platform/knowledge/change-requests?')) return Response.json({ changeRequests: [{ id: ID, title: 'Xanadu', status: state.status, countryId: 'XA', createdAt: '2026-11-10T00:00:00Z' }], nextCursor: null })
      if (url === '/api/platform/knowledge/sources') return Response.json({ sources: [], builtInUnavailable: null })
      if (init?.method !== 'POST') return Response.json(view())
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      calls.push({ path: url.slice(BASE.length), body })
      if (url === `${BASE}/review`) {
        for (const one of body.decisions as { revisionId: string; claimPath: string; decision: string; sourceChecked?: boolean }[]) {
          const claim = state.revisions.find((rev) => rev.revisionId === one.revisionId)?.claims.find((c) => c.path === one.claimPath)
          if (claim) claim.decision = one.decision
          if (one.sourceChecked) state.sourceChecked = true
        }
        return Response.json({ recorded: (body.decisions as unknown[]).length })
      }
      if (url === `${BASE}/decision`) {
        state.status = 'approved'
        state.approval = body.override ? 'single' : 'four_eyes'
        state.approvals = [{ approver: 'author', role: 'domain_expert', decisionSource: 'app', decidedAt: '2026-11-11T00:00:00Z', overrideReason: null }]
        return Response.json({ status: 'approved' })
      }
      if (url === `${BASE}/publish`) {
        state.releases.push({ channel: String(body.channel), action: 'publish' })
        if (body.channel === 'stable') state.status = 'published'
        return Response.json({ status: state.status })
      }
      return new Response('{}', { status: 404 })
    },
  }
}

const PERMISSIONS = [PLATFORM_PERMISSIONS.settingsView, PLATFORM_PERMISSIONS.knowledgeReview, PLATFORM_PERMISSIONS.knowledgeWrite, PLATFORM_PERMISSIONS.knowledgeApproveAlone]

let stub: ReturnType<typeof server>

beforeEach(() => {
  stub = server()
  vi.stubGlobal('fetch', vi.fn(stub.fetch))
})

describe('the owner’s path through the law map', () => {
  test('confirms every unit, approves alone, publishes to preview and to stable, without leaving the page', async () => {
    const user = userEvent.setup()
    render(
      <PlatformAccessProvider permissions={PERMISSIONS}>
        <LawMapPage countryId="XA" today="2026-11-11" />
      </PlatformAccessProvider>,
    )

    // Confirm what waits, one unit after another, ticking the source check where a page was pasted.
    for (let round = 0; round < 10; round += 1) {
      const next = await screen.findByTestId('next-to-confirm').catch(() => null)
      if (!next) break
      await user.click(next)
      const yes = (await screen.findAllByTestId(/^confirm-/))[0]!
      const tick = screen.queryByRole('checkbox')
      if (tick) await user.click(tick)
      await user.click(yes)
      await waitFor(() => expect(stub.calls.filter((call) => call.path === '/review').length).toBeGreaterThan(round))
    }
    expect(stub.state.revisions.flatMap((rev) => rev.claims).every((claim) => claim.decision === 'accepted')).toBe(true)
    expect(stub.state.sourceChecked).toBe(true)

    // Approve alone, with the reason the audit keeps.
    await user.click(await screen.findByRole('button', { name: 'Approve without a second review' }))
    const alone = await screen.findByRole('dialog', { name: 'Approve without a second review?' })
    await user.type(within(alone).getByTestId('approve-alone-reason'), 'One operator on dev; nobody else can approve it.')
    await user.click(within(alone).getByRole('button', { name: 'Approve without a second review' }))
    await waitFor(() => expect(stub.state.status).toBe('approved'))

    // Preview, then stable.
    await user.click(await screen.findByRole('button', { name: 'Publish to preview' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Publish to the preview?' })).getByRole('button', { name: 'Publish to preview' }))
    await waitFor(() => expect(stub.state.releases).toEqual([{ channel: 'preview', action: 'publish' }]))
    await user.click(await screen.findByRole('button', { name: 'Publish' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Publish?' })).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(stub.state.status).toBe('published'))

    expect(stub.calls.map((call) => call.path).filter((path) => path !== '/review')).toEqual(['/decision', '/publish', '/publish'])
    expect(stub.calls.find((call) => call.path === '/decision')?.body).toMatchObject({ decision: 'approve', role: 'domain_expert', override: { reason: 'One operator on dev; nobody else can approve it.' } })
    expect(await screen.findByRole('button', { name: 'Roll back' })).toBeInTheDocument()
  })
})

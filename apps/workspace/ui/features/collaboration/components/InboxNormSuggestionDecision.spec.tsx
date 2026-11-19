import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import type { InboxItemView } from '@/lib/inbox/types'
import { ProposalRequestError } from '@/lib/proposals/client'
import type { ProposalResponse } from '@/lib/proposals/types'
import { PRODUCT_NAME } from '@/lib/brand'
import { InboxItemRow } from './InboxItemRow'
import type { InboxNormDecisionClient } from './InboxNormSuggestionDecision'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/inbox',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const PROPOSAL = '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c'

const suggestion: InboxItemView = {
  id: 'i-norm',
  type: 'office_shelf.norm_suggested',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'project',
  resourceId: 'p1',
  anchorId: PROPOSAL,
  actorName: 'Anna Berger',
  actorUserId: 'u-anna',
  count: 1,
  href: '/app/projects/p1/files?folder=f-normen',
  subject: 'Wohnhaus Floridsdorf',
  related: null,
  excerpt: 'ÖNORM B 1600',
  mentions: [],
  variant: null,
  answerIn: null,
  createdAt: '2026-11-19T09:00:00Z',
  updatedAt: '2026-11-19T09:00:00Z',
}

const offer: InboxItemView = {
  ...suggestion,
  id: 'i-offer',
  type: 'office_shelf.norm_offered',
  anchorId: 'doc-1',
  actorName: null,
  actorUserId: null,
}

const decided = (status: 'applied' | 'dismissed', results: ProposalResponse['proposal']['results'] = null) =>
  ({ proposal: { status, results } }) as unknown as ProposalResponse

function client(overrides: Partial<InboxNormDecisionClient> = {}): InboxNormDecisionClient {
  return {
    apply: vi.fn(async () => decided('applied', [{ label: 'ÖNORM B 1600', ok: true }])),
    dismiss: vi.fn(async () => decided('dismissed')),
    ...overrides,
  }
}

const german = (row: InboxItemView, decisions: InboxNormDecisionClient = client()) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <ul>
        <InboxItemRow item={row} normDecisionClient={decisions} />
      </ul>
    </I18nProvider>
  )

describe('a norm suggested for the Büroablage, in the Postfach', () => {
  test('says who suggests which norm, and that the whole office will see it', () => {
    german(suggestion)
    expect(screen.getByText('Anna Berger schlägt eine Norm für die Büroablage vor')).toBeInTheDocument()
    expect(screen.getByText('ÖNORM B 1600')).toBeInTheDocument()
    expect(screen.getByText('Danach ist sie für alle im Büro sichtbar.')).toBeInTheDocument()
  })

  test('takes it into the Büroablage', async () => {
    const decisions = client()
    german(suggestion, decisions)
    await userEvent.click(screen.getByRole('button', { name: 'In die Büroablage übernehmen' }))
    expect(decisions.apply).toHaveBeenCalledWith(PROPOSAL)
    expect(await screen.findByRole('status')).toHaveTextContent('Liegt jetzt in der Büroablage. Das Projekt behält einen Verweis.')
  })

  test('declines it, and the norm stays in the project', async () => {
    const decisions = client()
    german(suggestion, decisions)
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    expect(decisions.dismiss).toHaveBeenCalledWith(PROPOSAL)
    expect(await screen.findByRole('status')).toHaveTextContent('Abgelehnt. Die Norm bleibt im Projekt.')
  })

  test('says why a move failed, and keeps the choice open', async () => {
    german(suggestion, client({ apply: vi.fn(async () => decided('failed' as 'applied', [{ label: 'ÖNORM B 1600', ok: false, reason: 'Folder not found' }])) }))
    await userEvent.click(screen.getByRole('button', { name: 'In die Büroablage übernehmen' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Das hat nicht geklappt: Folder not found')
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeEnabled()
  })

  test('says so when someone decided first', async () => {
    german(suggestion, client({ apply: vi.fn(async () => Promise.reject(new ProposalRequestError(409, 'CONFLICT', 'decided'))) }))
    await userEvent.click(screen.getByRole('button', { name: 'In die Büroablage übernehmen' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Jemand hat schon entschieden.')
  })

  test('offers no decision once it is resolved', () => {
    german({ ...suggestion, state: 'resolved' })
    expect(screen.queryByTestId('inbox-norm-decision')).not.toBeInTheDocument()
  })
})

describe('the offer of a project norm, in the Postfach', () => {
  test('is the agent suggesting the Büroablage, leading to the project folder', () => {
    german(offer)
    expect(screen.getByText(`${PRODUCT_NAME} schlägt die Büroablage vor`)).toHaveAttribute('href', '/app/projects/p1/files?folder=f-normen')
    expect(screen.queryByTestId('inbox-norm-decision')).not.toBeInTheDocument()
  })
})

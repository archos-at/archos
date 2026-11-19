import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import type { InboxItemView } from '@/lib/inbox/types'
import type { ProposalResponse } from '@/lib/proposals/types'
import { waitingGroups } from '../lib/inbox-queue'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'
import { InboxItemRow } from './InboxItemRow'
import { InboxQueueList } from './InboxQueueList'
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

const edition: InboxItemView = {
  id: 'i-edition',
  type: 'base_knowledge.new_edition',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'organization',
  resourceId: 'org-1',
  anchorId: 'önorm b 1600@2023-02-01',
  actorName: null,
  actorUserId: null,
  count: 1,
  href: '/app/base-knowledge?entry=edition_b1600',
  subject: 'ÖNORM B 1600:2017',
  related: '2023-02-01',
  via: 'OIB-RL 4 2023',
  excerpt: 'Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
  mentions: [],
  variant: 'via',
  answerIn: null,
  createdAt: '2026-11-19T09:00:00Z',
  updatedAt: '2026-11-19T09:00:00Z',
}

const suggested: InboxItemView = {
  ...edition,
  id: 'i-suggest',
  type: 'office_shelf.norm_suggested',
  resourceType: 'project',
  resourceId: 'p1',
  anchorId: '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c',
  href: '/app/projects/p1/files?folder=f-normen',
  subject: 'Wohnhaus Floridsdorf',
  related: null,
  via: null,
  excerpt: 'ÖNORM B 3691',
  variant: null,
  actorName: 'Anna Berger',
  actorUserId: 'u-anna',
}

const decisions = (): InboxNormDecisionClient => ({
  read: vi.fn(async () => ({ proposal: { status: 'proposed', results: [] } }) as unknown as ProposalResponse),
  apply: vi.fn(async () => ({ proposal: { status: 'applied', results: [] } }) as unknown as ProposalResponse),
  dismiss: vi.fn(async () => ({ proposal: { status: 'dismissed', results: [] } }) as unknown as ProposalResponse),
})

const row = (item: InboxItemView) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <NormDialogProvider dialog={NormDialog}>
        <ul>
          <InboxItemRow item={item} normDecisionClient={decisions()} />
        </ul>
      </NormDialogProvider>
    </I18nProvider>,
  )

const queue = (items: InboxItemView[]) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <NormDialogProvider dialog={NormDialog}>
        <InboxQueueList
          groups={waitingGroups(items, '2026-11-19')}
          news={[]}
          waitingCount={items.length}
          lateCount={0}
          currentId={null}
          hrefOf={(item) => item.href}
          onFollow={vi.fn()}
        />
      </NormDialogProvider>
    </I18nProvider>,
  )

const entryOf = (id: string): HTMLElement =>
  screen.getAllByTestId('inbox-queue-entry').find((entry) => entry.getAttribute('data-item-id') === id)!

describe('a new edition of a norm the office holds, in the Postfach', () => {
  test('is headed by the norm the office holds, and says which edition binds, under what, and which projects it concerns', () => {
    queue([edition])
    const entry = entryOf('i-edition')
    expect(entry.firstElementChild).toHaveTextContent('ÖNORM B 1600:2017 ist nicht mehr die verbindliche Ausgabe')
    expect(entry).toHaveTextContent(
      'Verbindlich ist die Ausgabe 2023-02-01, laut OIB-RL 4 2023. Betrifft: Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
    )
  })

  test('uploads the new edition from the norm’s entry, or opens the edition the office holds', () => {
    queue([edition])
    expect(screen.getByRole('link', { name: 'Neue Ausgabe hochladen' })).toHaveAttribute('href', '/app/base-knowledge?entry=edition_b1600')
    expect(screen.getByRole('link', { name: 'ÖNORM B 1600:2017 in Normen & Richtlinien ansehen' })).toHaveAttribute(
      'href',
      '/app/base-knowledge?file=edition_b1600',
    )
  })

  test('reads the same in the full list', () => {
    row(edition)
    expect(screen.getByTestId('inbox-item-link')).toHaveTextContent('ÖNORM B 1600:2017 ist nicht mehr die verbindliche Ausgabe')
    expect(screen.getByTestId('inbox-norm-lines')).toHaveTextContent('Betrifft: Wohnbau Seestadt Baufeld D12')
    expect(screen.queryByTestId('inbox-item-excerpt')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Neue Ausgabe hochladen' })).toHaveAttribute('href', '/app/base-knowledge?entry=edition_b1600')
  })

  test('offers nothing more once the office holds the edition or no project is affected', () => {
    row({ ...edition, state: 'resolved' })
    expect(screen.queryByTestId('inbox-norm-actions')).not.toBeInTheDocument()
  })
})

describe('a norm suggested for the Büroablage, the one norm item that asks for a decision', () => {
  test('a norm suggested for the Büroablage is accepted or declined right in the queue', () => {
    queue([suggested])
    const entry = entryOf('i-suggest')
    expect(entry.firstElementChild).toHaveTextContent('Anna Berger schlägt eine Norm für die Büroablage vor')
    expect(within(entry).getByTestId('inbox-norm-names')).toHaveTextContent('ÖNORM B 3691')
    expect(screen.getByRole('button', { name: 'In die Büroablage übernehmen' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeEnabled()
  })

  test('reads as itself in the full list too, with its decision', async () => {
    row(suggested)
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Abgelehnt. Die Norm bleibt im Projekt.')
  })
})

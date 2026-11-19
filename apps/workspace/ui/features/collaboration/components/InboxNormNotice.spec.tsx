import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import type { InboxItemView } from '@/lib/inbox/types'
import type { ProposalResponse } from '@/lib/proposals/types'
import { PRODUCT_NAME } from '@/lib/brand'
import { waitingGroups } from '../lib/inbox-queue'
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
  subject: 'ÖNORM B 1600',
  related: '2023-02-01',
  since: '2023-02-01',
  excerpt: 'Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
  mentions: [],
  variant: 'projects',
  answerIn: null,
  createdAt: '2026-11-19T09:00:00Z',
  updatedAt: '2026-11-19T09:00:00Z',
}

const found: InboxItemView = {
  ...edition,
  id: 'i-found',
  type: 'office_shelf.norms_found',
  anchorId: 'f-recht',
  count: 2,
  href: '/app/office-shelf?folder=f-recht',
  subject: null,
  related: null,
  since: null,
  excerpt: 'OENORM_B_1600_2017.pdf, OIB-RL_4_2023.pdf',
  variant: null,
}

const offered: InboxItemView = {
  ...edition,
  id: 'i-offer',
  type: 'office_shelf.norm_offered',
  resourceType: 'project',
  resourceId: 'p1',
  anchorId: 'doc-1',
  href: '/app/projects/p1/files?folder=f-normen',
  subject: 'Wohnhaus Floridsdorf',
  related: null,
  since: null,
  excerpt: 'ÖNORM B 3691',
  variant: null,
}

const suggested: InboxItemView = {
  ...offered,
  id: 'i-suggest',
  type: 'office_shelf.norm_suggested',
  anchorId: '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c',
  actorName: 'Anna Berger',
  actorUserId: 'u-anna',
}

const decisions = (): InboxNormDecisionClient => ({
  apply: vi.fn(async () => ({ proposal: { status: 'applied', results: [] } }) as unknown as ProposalResponse),
  dismiss: vi.fn(async () => ({ proposal: { status: 'dismissed', results: [] } }) as unknown as ProposalResponse),
})

const row = (item: InboxItemView) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <ul>
        <InboxItemRow item={item} normDecisionClient={decisions()} />
      </ul>
    </I18nProvider>,
  )

const queue = (items: InboxItemView[]) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <InboxQueueList
        groups={waitingGroups(items, '2026-11-19')}
        news={[]}
        waitingCount={items.length}
        lateCount={0}
        currentId={null}
        hrefOf={(item) => item.href}
        onFollow={vi.fn()}
      />
    </I18nProvider>,
  )

const entryOf = (id: string): HTMLElement =>
  screen.getAllByTestId('inbox-queue-entry').find((entry) => entry.getAttribute('data-item-id') === id)!

describe('a new edition of a norm the office holds, in the Postfach', () => {
  test('is headed by the norm, and says which edition applies since when and which projects it concerns', () => {
    queue([edition])
    const entry = entryOf('i-edition')
    expect(entry.firstElementChild).toHaveTextContent('ÖNORM B 1600: neue Ausgabe erschienen')
    expect(entry).toHaveTextContent(
      'Seit 01.02.2023 gilt die Ausgabe 2023-02-01, die Büroablage hat nur eine ältere. Betrifft Projekte mit Stichtag danach: Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
    )
  })

  test('uploads the new edition from the norm’s entry, or opens the edition the office holds', () => {
    queue([edition])
    expect(screen.getByRole('link', { name: 'Neue Ausgabe hochladen' })).toHaveAttribute('href', '/app/base-knowledge?entry=edition_b1600')
    expect(screen.getByRole('link', { name: 'ÖNORM B 1600 in Normen & Richtlinien ansehen' })).toHaveAttribute(
      'href',
      '/app/base-knowledge?file=edition_b1600',
    )
  })

  test('reads the same in the full list', () => {
    row(edition)
    expect(screen.getByTestId('inbox-item-link')).toHaveTextContent('ÖNORM B 1600: neue Ausgabe erschienen')
    expect(screen.getByTestId('inbox-norm-lines')).toHaveTextContent('Betrifft Projekte mit Stichtag danach: Wohnbau Seestadt Baufeld D12')
    expect(screen.queryByTestId('inbox-item-excerpt')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Neue Ausgabe hochladen' })).toHaveAttribute('href', '/app/base-knowledge?entry=edition_b1600')
  })

  test('offers nothing more once the office holds the edition', () => {
    row({ ...edition, state: 'resolved' })
    expect(screen.queryByTestId('inbox-norm-actions')).not.toBeInTheDocument()
  })
})

describe('the norm items, in one shape: what happened, which norm or files, what you can do', () => {
  test('norms found in folders lead to the folder, where the choice is made', () => {
    queue([found])
    const entry = entryOf('i-found')
    expect(entry.firstElementChild).toHaveTextContent(`${PRODUCT_NAME} hat 2 Normen in Ordnern gefunden`)
    expect(within(entry).getByTestId('inbox-norm-names')).toHaveTextContent('OENORM_B_1600_2017.pdf, OIB-RL_4_2023.pdf')
    expect(screen.getByRole('link', { name: 'Im Ordner entscheiden' })).toHaveAttribute('href', '/app/office-shelf?folder=f-recht')
  })

  test('a norm offered for the Büroablage leads to its project folder', () => {
    queue([offered])
    const entry = entryOf('i-offer')
    expect(entry.firstElementChild).toHaveTextContent(`${PRODUCT_NAME} schlägt eine Norm für die Büroablage vor`)
    expect(within(entry).getByTestId('inbox-norm-names')).toHaveTextContent('ÖNORM B 3691')
    expect(entry).toHaveTextContent('Bisher nur in „Wohnhaus Floridsdorf“. In der Büroablage finden alle Projekte sie.')
    expect(screen.getByRole('link', { name: 'Im Ordner entscheiden' })).toHaveAttribute('href', '/app/projects/p1/files?folder=f-normen')
  })

  test('a norm suggested for the Büroablage is accepted or declined right in the queue', () => {
    queue([suggested])
    const entry = entryOf('i-suggest')
    expect(entry.firstElementChild).toHaveTextContent('Anna Berger schlägt eine Norm für die Büroablage vor')
    expect(within(entry).getByTestId('inbox-norm-names')).toHaveTextContent('ÖNORM B 3691')
    expect(screen.getByRole('button', { name: 'In die Büroablage übernehmen' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeEnabled()
  })

  test('each reads as itself in the full list too, with its action', async () => {
    const { unmount } = row(found)
    expect(screen.getByRole('link', { name: 'Im Ordner entscheiden' })).toHaveAttribute('href', '/app/office-shelf?folder=f-recht')
    unmount()
    row(suggested)
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Abgelehnt. Die Norm bleibt im Projekt.')
  })
})

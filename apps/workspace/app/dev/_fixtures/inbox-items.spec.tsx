import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import { proposalResponseSchema } from '@/lib/proposals/types'
import { InboxQueueList } from '@/features/collaboration/components/InboxQueueList'
import { waitingGroups } from '@/features/collaboration/lib/inbox-queue'
import { NORM_NOTICE_TYPES } from '@/features/collaboration/lib/inbox-norm-notice'
import { decidedNormProposal, ITEMS } from './inbox-items'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dev/inbox',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('/dev/inbox', () => {
  test('waits with every norm item, each with its action', () => {
    const items = ITEMS.filter((item) => (NORM_NOTICE_TYPES as readonly string[]).includes(item.type))
    expect(items.map((item) => item.type).sort()).toEqual([...NORM_NOTICE_TYPES].sort())
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
    const entries = screen.getAllByTestId('inbox-queue-entry')
    expect(entries).toHaveLength(NORM_NOTICE_TYPES.length)
    for (const entry of entries) {
      const actions = entry.parentElement!
      expect(within(actions).queryAllByTestId(/^inbox-norm-(uploadEdition|decideInFolder|decision)$/).length).toBeGreaterThan(0)
    }
  })

  test('answers a norm suggestion’s decision in the shape the client reads', () => {
    expect(proposalResponseSchema.safeParse(decidedNormProposal('applied')).success).toBe(true)
    expect(proposalResponseSchema.safeParse(decidedNormProposal('dismissed')).success).toBe(true)
  })
})

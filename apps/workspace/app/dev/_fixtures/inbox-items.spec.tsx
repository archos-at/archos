import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import { proposalResponseSchema } from '@/lib/proposals/types'
import { InboxItemRow } from '@/features/collaboration/components/InboxItemRow'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'
import { NORM_NOTICE_TYPES } from '@/features/collaboration/lib/inbox-norm-notice'
import { ITEMS, normProposal } from './inbox-items'

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
  test('carries every norm item, each with its action', () => {
    const items = ITEMS.filter((item) => (NORM_NOTICE_TYPES as readonly string[]).includes(item.type))
    expect(items.map((item) => item.type).sort()).toEqual([...NORM_NOTICE_TYPES].sort())
    for (const item of items) {
      render(
        <I18nProvider initialLocale="de" fixedLocale>
          <NormDialogProvider dialog={NormDialog}>
            <ul>
              <InboxItemRow item={item} />
            </ul>
          </NormDialogProvider>
        </I18nProvider>,
      )
      expect(screen.queryAllByTestId(/^inbox-norm-(uploadEdition|decision)$/).length, item.type).toBeGreaterThan(0)
      cleanup()
    }
  })

  test('answers a norm suggestion’s decision in the shape the client reads', () => {
    expect(proposalResponseSchema.safeParse(normProposal('applied')).success).toBe(true)
    expect(proposalResponseSchema.safeParse(normProposal('dismissed')).success).toBe(true)
    expect(proposalResponseSchema.safeParse(normProposal('proposed')).success).toBe(true)
  })
})

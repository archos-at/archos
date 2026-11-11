/**
 * The E-Mail-Eingang's header action: the address itself (a press copies it),
 * „Adresse erzeugen" for a manager without one, nothing for a member without one.
 */

import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'
import { InboundMailHeaderActions } from './inbound-mail-header-actions'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const ADDRESS = 'project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org'
const view = (over: Partial<InboundMailAddressView>): InboundMailAddressView => ({
  state: 'active',
  address: ADDRESS,
  canManage: true,
  lastReceivedAt: null,
  droppedLast30Days: 0,
  ownDomainVerifiedShare: null,
  ...over,
})

describe('InboundMailHeaderActions', () => {
  it('copies the address with a press that says so, and opens the details beside it', async () => {
    const onOpen = vi.fn()
    render(<InboundMailHeaderActions state={{ kind: 'ready', address: view({}) }} onOpenAddress={onOpen} />)
    // The press, not the 45 characters: the address is read in the dialog and the empty state.
    expect(screen.getByTestId('inbound-mail-address-copy')).toHaveTextContent('Copy address')
    expect(screen.getByTestId('inbound-mail-header-address')).not.toHaveTextContent(ADDRESS)
    await userEvent.click(screen.getByTestId('inbound-mail-address-open'))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('offers a manager without an address to create one, and a member nothing', () => {
    const { unmount } = render(
      <InboundMailHeaderActions state={{ kind: 'ready', address: view({ state: 'none', address: null }) }} onOpenAddress={vi.fn()} />
    )
    expect(screen.getByTestId('inbound-mail-address-open')).toHaveTextContent('Create address')
    unmount()
    render(
      <InboundMailHeaderActions
        state={{ kind: 'ready', address: view({ state: 'none', address: null, canManage: false }) }}
        onOpenAddress={vi.fn()}
      />
    )
    expect(screen.queryByTestId('inbound-mail-address-open')).not.toBeInTheDocument()
  })
})

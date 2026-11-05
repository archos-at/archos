import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'

vi.mock('@/lib/release-notes/client', () => ({ postReleaseSummarySeen: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { capturePosthog } from '@/lib/analytics/posthog'
import { postReleaseSummarySeen } from '@/lib/release-notes/client'
import type { WhatsNewNoticeState } from '@/lib/release-notes/release-notes-wire'
import { WhatsNewNotice } from './whats-new-notice'

const STATE: WhatsNewNoticeState = {
  summary: {
    id: '2026-W44',
    date: '2026-10-26',
    dateEnd: '2026-11-01',
    summary: { en: 'Ctrl+K now searches everything your office holds.', de: 'Strg+K durchsucht jetzt alles.' },
  },
  quietly: false,
}

describe('WhatsNewNotice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the week’s summary, and only the summary, with the way to every change', async () => {
    render(<WhatsNewNotice state={STATE} settleMs={0} />)
    const notice = await screen.findByRole('dialog', { name: 'New this week' })
    expect(notice).toHaveTextContent('Ctrl+K now searches everything your office holds.')
    expect(screen.getByRole('link', { name: 'See everything new' })).toHaveAttribute('href', '/app/whats-new')
    // Focus moves to its first action, so a keyboard reader lands on it.
    await waitFor(() => expect(screen.getByRole('button', { name: "Don't show again" })).toHaveFocus())
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_shown', { week: '2026-W44' })
  })

  it('once closed, records the week and never shows again', async () => {
    const { rerender } = render(<WhatsNewNotice state={STATE} settleMs={0} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Close', exact: true }))
    expect(postReleaseSummarySeen).toHaveBeenCalledWith('2026-W44')
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_dismissed', { week: '2026-W44', via: 'close_button' })
    rerender(<WhatsNewNotice state={STATE} settleMs={0} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape closes it and counts as seen', async () => {
    render(<WhatsNewNotice state={STATE} settleMs={0} />)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(postReleaseSummarySeen).toHaveBeenCalledWith('2026-W44')
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_dismissed', { week: '2026-W44', via: 'escape' })
  })

  it('following its link counts as seen', async () => {
    render(<WhatsNewNotice state={STATE} settleMs={0} />)
    await userEvent.click(await screen.findByRole('link', { name: 'See everything new' }))
    expect(postReleaseSummarySeen).toHaveBeenCalledWith('2026-W44')
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_opened', { week: '2026-W44' })
  })

  it('"Don\'t show again" turns it off for good', async () => {
    render(<WhatsNewNotice state={STATE} settleMs={0} />)
    await userEvent.click(await screen.findByRole('button', { name: "Don't show again" }))
    expect(postReleaseSummarySeen).toHaveBeenCalledWith('2026-W44', true)
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_opted_out', { week: '2026-W44', surface: 'notice' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('someone new here is never shown it: the week is recorded without a word', async () => {
    render(<WhatsNewNotice state={{ ...STATE, quietly: true }} settleMs={0} />)
    await waitFor(() => expect(postReleaseSummarySeen).toHaveBeenCalledWith('2026-W44'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(capturePosthog).not.toHaveBeenCalled()
  })

  it('waits while a product tour runs, then shows', async () => {
    const { rerender } = render(<WhatsNewNotice state={STATE} deferred settleMs={0} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postReleaseSummarySeen).not.toHaveBeenCalled()
    rerender(<WhatsNewNotice state={STATE} settleMs={0} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows nothing when the server has nothing to show (seen, opted out, or no summary)', () => {
    render(<WhatsNewNotice state={null} settleMs={0} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postReleaseSummarySeen).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'

vi.mock('@/lib/release-notes/client', () => ({ putReleaseNoticePreference: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { capturePosthog } from '@/lib/analytics/posthog'
import { putReleaseNoticePreference } from '@/lib/release-notes/client'
import { WhatsNewNoticeSettings } from './whats-new-notice-settings'

describe('WhatsNewNoticeSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('turns the weekly notice back on for someone who turned it off', async () => {
    render(<WhatsNewNoticeSettings initialEnabled={false} />)
    const toggle = screen.getByRole('switch', { name: 'Show the weekly summary as a notice' })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(putReleaseNoticePreference).toHaveBeenCalledWith(true)
    expect(toggle).toBeChecked()
    expect(capturePosthog).toHaveBeenCalledWith('whats_new_opted_in', { surface: 'profile' })
  })

  it('goes back and says so when the server did not keep it', async () => {
    vi.mocked(putReleaseNoticePreference).mockResolvedValueOnce(false)
    render(<WhatsNewNoticeSettings initialEnabled />)
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved')
  })
})

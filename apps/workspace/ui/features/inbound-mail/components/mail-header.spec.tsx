/**
 * The detail opens on the mail (the owner's review, 2026-10-27): one line of
 * who, how far confirmed and when; the evidence (sent time, recipients, the
 * original with its warning, the expiry) one press away behind „Details“;
 * the expiry forward only in its last week; a clean scan silent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files/mail',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { capturePosthog } from '@/lib/analytics/posthog'
import { render, screen, within } from '@/test-utils'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient } from '@/app/dev/inbound-mail/fixtures'
import { expiryShownInline } from '../lib/evidence'
import { InboundMailDetail } from './inbound-mail-detail'
import { SenderWaitLine } from './sender-trust'

function renderDetail(name: string) {
  const fixture = DETAIL_VARIANTS[name]
  return render(
    <InboundMailDetail
      projectId={PROJECT_ID}
      mailId={fixture.view.id}
      initial={fixture.view}
      initialText={fixture.text}
      folders={FOLDERS}
      client={fixtureClient({ detail: fixture })}
      onChanged={vi.fn()}
      now={FIXTURE_NOW}
      pollMs={1}
    />
  )
}

beforeEach(() => vi.clearAllMocks())

describe('MailHeader', () => {
  it('says who, then how far confirmed and when, and folds the evidence behind „Details“', async () => {
    renderDetail('member-verified')
    const line = screen.getByTestId('mail-header-line')
    expect(within(line).getByTestId('mail-header-from')).toHaveTextContent('Miriam Huber ‹m.huber@huber-architektur.at›')
    // Trust is never folded away.
    expect(within(line).getByTestId('sender-trust')).toHaveTextContent('Domain verified: huber-architektur.at')
    expect(within(line).getByTestId('mail-header-received')).toBeInTheDocument()
    // The original, its warning, the recipients and the expiry wait behind „Details“.
    expect(screen.queryByTestId('mail-original')).toBeNull()
    expect(screen.queryByText('Opens in your mail program; images from outside are loaded there.')).toBeNull()
    expect(screen.queryByText(/post@ma37\.wien\.gv\.at/)).toBeNull()
    expect(screen.queryByTestId('mail-expires')).toBeNull()

    await userEvent.click(screen.getByTestId('mail-details-toggle'))
    const details = screen.getByTestId('mail-details')
    expect(within(details).getByTestId('mail-original')).toBeInTheDocument()
    expect(details).toHaveTextContent('Opens in your mail program; images from outside are loaded there.')
    expect(details).toHaveTextContent('Sent')
    expect(details).toHaveTextContent('post@ma37.wien.gv.at')
    expect(within(details).getByTestId('mail-expires')).toHaveTextContent('then it expires')
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_details_opened', { status: 'waiting', risk_level: 'none' })
  })

  it('puts the text right after the header, before any part can be checked', () => {
    renderDetail('member-verified')
    const header = screen.getByTestId('mail-header')
    const text = screen.getByText(/der Bescheid zum Stellplatznachweis ist gestern gekommen/)
    const checkbox = screen.getByTestId('attachment-checkbox')
    expect(header.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('brings the expiry forward only in its last week', () => {
    renderDetail('expires-soon')
    expect(screen.getByTestId('mail-expires-soon')).toHaveTextContent('Waits only until')
  })

  it('keeps a month-away expiry in „Details“', () => {
    renderDetail('member-verified')
    expect(screen.queryByTestId('mail-expires-soon')).toBeNull()
  })

  it('is silent about a clean scan and speaks when one runs or failed', () => {
    renderDetail('member-verified')
    expect(screen.queryByText('Checked for malware')).toBeNull()
    expect(screen.queryByTestId('status-scan-pending')).toBeNull()
  })

  it('says a running and a failed scan on their rows', () => {
    renderDetail('scan-pending')
    expect(screen.getByTestId('status-scan-pending')).toBeInTheDocument()
    expect(screen.getByTestId('status-scan-failed')).toBeInTheDocument()
  })
})

describe('expiryShownInline', () => {
  const day = 86_400_000
  it('is true for a waiting mail with fewer than seven days left', () => {
    expect(expiryShownInline({ status: 'waiting', expiresAt: new Date(FIXTURE_NOW + 6.9 * day).toISOString() }, FIXTURE_NOW)).toBe(true)
  })
  it('is false at seven days or more, and for a handled mail', () => {
    expect(expiryShownInline({ status: 'waiting', expiresAt: new Date(FIXTURE_NOW + 7 * day).toISOString() }, FIXTURE_NOW)).toBe(false)
    expect(expiryShownInline({ status: 'handled', expiresAt: new Date(FIXTURE_NOW + day).toISOString() }, FIXTURE_NOW)).toBe(false)
  })
})

describe('why a mail waits (ADR-0137, amendment of 2026-11-03)', () => {
  it('asks the member a mail with their address whether they sent it, and lets them file it saying so', () => {
    renderDetail('own-unverified')
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'signatureOwn')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Did you send this mail? Your domain did not verify it')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Member · domain not verified')
  })

  it('tells the member their own rejected mail in their own voice, once: no fraud warning about themself, no second question (B4)', () => {
    renderDetail('impersonation')
    expect(screen.getByTestId('impersonation-warning')).toHaveAttribute('data-own', 'true')
    expect(screen.getByTestId('impersonation-warning')).toHaveTextContent('This mail carries your address, but your domain rejected it.')
    expect(screen.getByTestId('impersonation-warning')).not.toHaveTextContent('poses as')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Your address · rejected by your domain')
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
  })

  it('says a verified writer’s mail direct filing left waits for any writer, with the next step (not_filed)', () => {
    renderDetail('not-filed')
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'not_filed')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Miriam Huber sent it and the domain verified it, but it was not filed directly. Check it, then file or dismiss it.')
    expect(screen.queryByTestId('claimed-mail-bar')).toBeNull()
    expect(screen.getAllByTestId('attachment-checkbox').length).toBeGreaterThan(0)
  })

  it('says a signed writer’s mail held as re-sent or misdated, or as sent automatically, waits for that, not for a bad signature', () => {
    const { unmount } = render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'replay', onlySenderReleases: false }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'replayOwn')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('addressed to others, oddly dated or already known')
    expect(screen.getByTestId('sender-wait-reason')).not.toHaveTextContent('signature does not match')
    unmount()
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'automatic', onlySenderReleases: true }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'automatic')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('sent automatically')
  })

  it('says a verified writer’s mail waits because direct filing is off, for any writer: never asked of its member alone', () => {
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'paused', onlySenderReleases: false }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'paused')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Anyone who may file in this project can file it')
    expect(screen.getByTestId('sender-wait-reason')).not.toHaveTextContent('Did you send this mail?')
  })

  it('tells another writer whom it waits for, once, and offers them only „Dismiss …“ (B2)', () => {
    renderDetail('claimed-by-colleague')
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'signature')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Waiting for Miriam Huber: the domain did not verify this mail.')
    // Said once: no hypothetical about a member who left under the line, no second warning in the bar.
    expect(screen.getByTestId('inbound-mail-detail')).not.toHaveTextContent('has left the office')
    expect(screen.getByTestId('claimed-mail-bar')).toHaveTextContent('Only Miriam Huber can file or restore this mail. You can dismiss it.')
    expect(screen.queryByTestId('decision-bar')).toBeNull()
    expect(screen.queryByTestId('decision-file')).toBeNull()
    expect(screen.queryByTestId('acknowledge-sender')).toBeNull()
    expect(screen.queryByTestId('attachment-checkbox')).toBeNull()
    expect(screen.queryByTestId('attachment-change')).toBeNull()
    expect(screen.getByTestId('decision-dismiss')).toHaveTextContent('Dismiss …')
  })

  it('says a sender the directory could not check could not be checked, never an outsider’s 14 days (R14)', () => {
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'sender_unchecked', onlySenderReleases: false }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'sender_unchecked')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('could not be checked. Check the address and the domain above before you file.')
    expect(screen.getByTestId('sender-wait-reason')).not.toHaveTextContent('outside the office')
  })

  it('says an outsider’s mail expires after 14 days for good, and a member without write rights waits for the writers', () => {
    const { unmount } = renderDetail('external-unverified')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('it expires after 14 days and cannot be restored')
    unmount()
    renderDetail('member-verified')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Waiting for you to file it, because the sender may not file in this project.')
  })
})

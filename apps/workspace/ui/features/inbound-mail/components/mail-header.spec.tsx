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
    expect(within(line).getByTestId('mail-header-from')).toHaveTextContent('Miriam Huber m.huber@huber-architektur.at')
    expect(within(line).getByTestId('sender-trust')).toHaveTextContent('Address verified')
    expect(within(line).getByTestId('sender-trust')).toHaveAttribute('data-tone', 'confirmed')
    expect(screen.queryByTestId('mail-trust-technical')).toBeNull()
    expect(within(line).getByTestId('mail-header-received')).toBeInTheDocument()
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
    expect(within(details).getByTestId('mail-trust-technical')).toHaveTextContent('Domain verified: huber-architektur.at signed the mail (DKIM).')
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_details_opened', { status: 'waiting', risk_level: 'none' })
  })

  it('puts the text right after the header, before the attachments', () => {
    renderDetail('member-verified')
    const header = screen.getByTestId('mail-header')
    const text = screen.getByText(/der Bescheid der MA 37 zum Stellplatznachweis/)
    const checkbox = screen.getByTestId('attachments-list')
    expect(header.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('brings the expiry forward only in its last week', () => {
    renderDetail('expires-soon')
    expect(screen.getByTestId('mail-expires-soon')).toHaveTextContent(/^Leaves the project mail on .+ unless someone files it$/)
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
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('Waiting for you: did you send this mail? Whether it comes from you cannot be verified')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Your address, cannot be verified')
    expect(screen.getByTestId('sender-trust')).toHaveAttribute('data-tone', 'neutral')
  })

  it('tells the member their own rejected mail in their own voice, once: no fraud warning about themself, no second question (B4)', () => {
    renderDetail('impersonation')
    expect(screen.getByTestId('impersonation-warning')).toHaveAttribute('data-own', 'true')
    expect(screen.getByTestId('impersonation-warning')).toHaveTextContent('This mail carries your address, but your domain rejected it.')
    expect(screen.getByTestId('impersonation-warning')).not.toHaveTextContent('poses as')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Your address, rejected by your domain')
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
  })

  it('says nothing in the pane about why a verified writer’s mail waits (not_filed): there is nothing to do but file it', () => {
    renderDetail('not-filed')
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
    expect(screen.queryByTestId('claimed-mail-bar')).toBeNull()
    expect(screen.getByTestId('decision-open')).toBeInTheDocument()
  })

  it('says a signed writer’s mail held as re-sent or misdated, or as sent automatically, waits for that, not for a bad signature', () => {
    const { unmount } = render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'replay', ownClaimedMail: true }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'replayOwn')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('addressed to others, oddly dated or already known')
    expect(screen.getByTestId('sender-wait-reason')).not.toHaveTextContent('signature does not match')
    unmount()
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'automatic', ownClaimedMail: false }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'automatic')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('sent automatically')
  })

  it('says a wait reason only where it asks the reader something or the mail will be gone (paused, no_write_rights stay quiet)', () => {
    const { unmount } = render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'paused', ownClaimedMail: false }} />)
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
    unmount()
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'no_write_rights', ownClaimedMail: false }} />)
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
  })

  it('lets another writer file a writer’s unsigned mail once they say they checked it is from them (amendment of 2026-11-19)', async () => {
    renderDetail('claimed-by-colleague')
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'signature')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent(
      'Waiting to be filed: whether the mail comes from Miriam Huber cannot be verified. File it once you have checked it is from Miriam Huber.',
    )
    expect(screen.getByTestId('inbound-mail-detail')).not.toHaveTextContent('has left the office')
    expect(screen.queryByTestId('claimed-mail-bar')).toBeNull()
    expect(screen.getByTestId('decision-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Miriam Huber’s address, cannot be verified')
    await userEvent.click(screen.getByTestId('decision-open'))
    expect(await screen.findByRole('heading', { name: 'Is this mail from Miriam Huber?' })).toBeInTheDocument()
    expect(screen.getByTestId('acknowledge-sender-row')).toHaveTextContent(/^I checked this mail is from Miriam Huber$/)
    expect(screen.getByTestId('inbound-mail-detail')).not.toHaveTextContent('did you send this mail')
  })

  it('still offers another writer only „Dismiss …“ for an impersonation of a writer (B2)', () => {
    renderDetail('impersonation-colleague')
    expect(screen.getByTestId('claimed-mail-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-file')).toBeNull()
    expect(screen.queryByTestId('acknowledge-sender')).toBeNull()
    expect(screen.queryByTestId('attachment-checkbox')).toBeNull()
  })

  it('says a sender the directory could not check could not be checked, never an outsider’s 14 days (R14)', () => {
    render(<SenderWaitLine view={{ status: 'waiting', waitReason: 'sender_unchecked', ownClaimedMail: false }} />)
    expect(screen.getByTestId('sender-wait-reason')).toHaveAttribute('data-reason', 'sender_unchecked')
    expect(screen.getByTestId('sender-wait-reason')).toHaveTextContent('could not be checked. Check the address and the sender above before you file.')
    expect(screen.getByTestId('sender-wait-reason')).not.toHaveTextContent('outside the office')
  })

  it('says calmly when an outsider’s mail leaves the project mail and that a reminder comes, and asks for no check of it', () => {
    const { unmount } = renderDetail('external-unverified')
    const line = screen.getByTestId('sender-wait-reason')
    expect(line).toHaveTextContent(/^Leaves the project mail on .+ unless someone files it\. \S+ reminds you 5 days before\.$/)
    expect(line).not.toHaveAttribute('data-asks')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Sender cannot be verified')
    expect(screen.getByTestId('sender-trust')).toHaveAttribute('data-tone', 'neutral')
    unmount()
    renderDetail('expires-soon')
    expect(screen.getByTestId('mail-expires-soon')).toHaveTextContent(/Leaves the project mail on .+ unless someone files it/)
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
  })

  it('says nothing of a colleague without the right to file: the mail is simply the reader’s to file', () => {
    renderDetail('member-verified')
    expect(screen.queryByTestId('sender-wait-reason')).toBeNull()
    expect(screen.getByTestId('decision-open')).toBeInTheDocument()
  })

  it('draws a forgery’s verdict in the danger colour', () => {
    renderDetail('member-name')
    expect(screen.getByTestId('sender-trust')).toHaveTextContent('Caution: possible forgery')
    expect(screen.getByTestId('sender-trust')).toHaveAttribute('data-tone', 'danger')
  })
})

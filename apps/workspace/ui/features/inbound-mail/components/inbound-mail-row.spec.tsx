import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { mail, messagePart, part, summaryOf } from '@/app/dev/inbound-mail/fixture-builders'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
import { InboundMailRow } from './inbound-mail-row'

const handled = (overrides: Partial<InboundMailSummaryView> = {}) =>
  summaryOf(
    mail({ status: 'handled', parts: [messagePart({ state: 'filed' }), part({ name: 'S-102.pdf', state: 'filed' })] }),
    overrides,
  )

function row(summary: InboundMailSummaryView, props: Partial<Parameters<typeof InboundMailRow>[0]> = {}) {
  return render(
    <ul>
      <InboundMailRow mail={summary} href="/files/mail/x" open={false} focused={false} checked={false} onCheckedChange={() => {}} selecting={false} {...props} />
    </ul>,
  )
}

const NOW = Date.parse('2026-11-19T12:00:00Z')
const ready = (overrides: Partial<InboundMailSummaryView> = {}) => summaryOf(mail({ key: 'ready' }), overrides)

describe('a handled mail filed without a click', () => {
  it('says so, and names the Verlauf it went into', () => {
    row(handled({ filedWithoutClick: { to: { name: 'Statik Einreichung', folderPath: 'Korrespondenz', version: null } } }))
    expect(screen.getByTestId('inbound-mail-row-filed-without-click').textContent).toBe('Filed without a click → Statik Einreichung')
  })

  it('says so without a place when the reader may not open where it went', () => {
    row(handled({ filedWithoutClick: { to: null } }))
    expect(screen.getByTestId('inbound-mail-row-filed-without-click').textContent).toBe('Filed without a click')
  })

  it('says nothing of it for a mail a person filed', () => {
    row(handled({ filedWithoutClick: null }))
    expect(screen.queryByTestId('inbound-mail-row-filed-without-click')).toBeNull()
    expect(screen.getByTestId('inbound-mail-row-outcome')).toBeTruthy()
  })
})

describe('a ready mail says where one press files it', () => {
  it('names the E-Mail-Verlauf its text joins and the folder of its attachment', () => {
    row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Verfahren MA 37' }, files: 1, folders: ['Behörde/Bescheide'] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('Mail text to “Verfahren MA 37”\u00A0· Attachment to Behörde/Bescheide')
    expect(screen.queryByTestId('inbound-mail-row-thread')).toBeNull()
  })

  it('counts files spread over folders, names the top level, and says a new Verlauf', () => {
    const { unmount } = row(ready({ suggestedPlaces: { text: { kind: 'new_thread' }, files: 3, folders: ['Tragwerk', 'Behörde'] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('Mail text as a new mail thread\u00A0· 3 attachments to 2 folders')
    unmount()
    row(ready({ suggestedPlaces: { text: null, files: 2, folders: [''] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('2 attachments to Files (top level)')
  })

  it('leaves the text out under its own thread group, whose line already names the Verlauf', () => {
    const { unmount } = row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Stellplatznachweis' }, files: 1, folders: ['Tragwerk'] } }), { inGroup: true, groupThread: 'Stellplatznachweis' })
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('Attachment to Tragwerk')
    unmount()
    row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Stellplatznachweis' }, files: 0, folders: [] } }), { inGroup: true, groupThread: 'Stellplatznachweis' })
    expect(screen.queryByTestId('inbound-mail-row-places')).toBeNull()
  })

  it('says nothing of places on a mail that needs the reader first', () => {
    row(ready({ incompleteReason: 'no_thread', suggestedPlaces: { text: null, files: 1, folders: ['Tragwerk'] } }))
    expect(screen.queryByTestId('inbound-mail-row-places')).toBeNull()
    expect(screen.getByTestId('inbound-mail-row-reason')).toHaveTextContent('No matching mail thread')
  })
})

describe('a mail in its last days', () => {
  const day = (iso: string) => new Intl.DateTimeFormat('en', { day: '2-digit', month: '2-digit' }).format(new Date(iso))

  it('says the day an outsider’s mail is removed, and offers „Einordnen“ at rest', async () => {
    const onFileNow = vi.fn()
    const expiresAt = new Date(NOW + 2 * 86_400_000).toISOString()
    row(ready({ senderClass: 'external', senderFlags: [], expiresAt, incompleteReason: 'no_thread' }), { now: NOW, onFileNow })
    expect(screen.getByTestId('inbound-mail-row-expiry').textContent).toBe(`Will be removed on ${day(expiresAt)} unless someone files it`)
    await userEvent.click(screen.getByTestId('inbound-mail-row-file-now'))
    expect(onFileNow).toHaveBeenCalledOnce()
  })

  it('says a member’s mail expires, not that it is removed', () => {
    const expiresAt = new Date(NOW + 86_400_000).toISOString()
    row(ready({ senderClass: 'office_member', expiresAt }), { now: NOW, onFileNow: () => {} })
    expect(screen.getByTestId('inbound-mail-row-expiry').textContent).toBe(`Expires on ${day(expiresAt)} unless someone files it`)
  })

  it('says nothing and offers nothing before its last five days', () => {
    row(ready({ senderClass: 'external', expiresAt: new Date(NOW + 6 * 86_400_000).toISOString() }), { now: NOW, onFileNow: () => {} })
    expect(screen.queryByTestId('inbound-mail-row-expiry')).toBeNull()
    expect(screen.queryByTestId('inbound-mail-row-file-now')).toBeNull()
  })
})

describe('a handled mail a person filed', () => {
  it('names where it went', () => {
    row(handled({ filedWithoutClick: null, filedTo: { name: 'Stellplatznachweis', folderPath: 'Korrespondenz', version: 5 } }))
    expect(screen.getByTestId('inbound-mail-row-outcome').textContent).toBe('Filed → “Stellplatznachweis”')
  })
})

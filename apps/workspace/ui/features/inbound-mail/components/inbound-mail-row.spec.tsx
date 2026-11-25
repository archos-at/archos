import { describe, expect, it } from 'vitest'
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

describe('a settled mail, whose subject and sender were erased when it was filed', () => {
  it('is named by the Verlauf it went into, with no empty sender line', () => {
    row(handled({ subject: null, senderName: null, senderDomain: null, filedTo: { name: 'Das ist ein Test', folderPath: 'Korrespondenz', version: null } }))
    expect(screen.getByRole('listitem').textContent).toContain('Das ist ein Test')
    expect(screen.queryByText('(no subject)')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.queryByText('?')).toBeNull()
  })
})

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

describe('a ready mail says on its second line where one press files it', () => {
  it('names the folder of its attachment, and counts the other places', () => {
    row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Verfahren MA 37' }, files: 1, folders: ['Behörde/Bescheide'] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('→ Behörde/Bescheide +1')
  })

  it('names the Verlauf when the text is all it files, and the top level by its name', () => {
    const { unmount } = row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Verfahren MA 37' }, files: 0, folders: [] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('→ “Verfahren MA 37”')
    unmount()
    row(ready({ suggestedPlaces: { text: null, files: 2, folders: [''] } }))
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('→ Files (top level)')
  })

  it('leaves the text out under its own thread label, whose line already names the Verlauf', () => {
    row(ready({ suggestedPlaces: { text: { kind: 'thread', name: 'Stellplatznachweis' }, files: 1, folders: ['Tragwerk'] } }), { inGroup: true, groupThread: 'Stellplatznachweis' })
    expect(screen.getByTestId('inbound-mail-row-places').textContent).toBe('→ Tragwerk')
  })

  it('says what it needs instead on a mail that needs the reader first, with the warning glyph and ink words', () => {
    row(ready({ incompleteReason: 'no_thread', suggestedPlaces: { text: null, files: 1, folders: ['Tragwerk'] } }))
    expect(screen.queryByTestId('inbound-mail-row-places')).toBeNull()
    expect(screen.getByTestId('inbound-mail-row-reason')).toHaveTextContent('No matching mail thread')
    expect(screen.getByTestId('inbound-mail-row-reason')).toHaveClass('text-foreground')
  })

  it('is two lines: no avatar, no press of its own', () => {
    row(ready())
    expect(screen.getByRole('listitem').querySelector('[data-slot="avatar"]')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('a mail in its last days', () => {
  const day = (iso: string) => new Intl.DateTimeFormat('en', { day: '2-digit', month: '2-digit' }).format(new Date(iso))

  it('says until when it stays, in place of the time it came', () => {
    const expiresAt = new Date(NOW + 2 * 86_400_000).toISOString()
    row(ready({ senderClass: 'external', senderFlags: [], expiresAt, incompleteReason: 'no_thread' }), { now: NOW })
    expect(screen.getByTestId('inbound-mail-row-expiry').textContent).toBe(`until ${day(expiresAt)}`)
  })

  it('says nothing before its last five days', () => {
    row(ready({ senderClass: 'external', expiresAt: new Date(NOW + 6 * 86_400_000).toISOString() }), { now: NOW })
    expect(screen.queryByTestId('inbound-mail-row-expiry')).toBeNull()
  })
})

describe('a handled mail a person filed', () => {
  it('names where it went', () => {
    row(handled({ filedWithoutClick: null, filedTo: { name: 'Stellplatznachweis', folderPath: 'Korrespondenz', version: 5 } }))
    expect(screen.getByTestId('inbound-mail-row-outcome').textContent).toBe('Filed → “Stellplatznachweis”')
  })
})

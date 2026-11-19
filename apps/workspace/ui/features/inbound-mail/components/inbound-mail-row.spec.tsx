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

function row(summary: InboundMailSummaryView) {
  return render(
    <ul>
      <InboundMailRow mail={summary} href="/files/mail/x" open={false} focused={false} checked={false} onCheckedChange={() => {}} selecting={false} />
    </ul>,
  )
}

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

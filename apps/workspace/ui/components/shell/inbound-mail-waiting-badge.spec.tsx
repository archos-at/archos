import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import { InboundMailWaitingBadge } from './inbound-mail-waiting-badge'

describe('InboundMailWaitingBadge', () => {
  it('shows the count it was given', () => {
    render(<InboundMailWaitingBadge count={4} />)
    expect(screen.getByTestId('inbound-mail-badge')).toHaveTextContent('4')
    expect(screen.getByTestId('inbound-mail-badge')).toHaveAccessibleName('4 mails waiting to be filed')
  })

  it('says a cut count is one: „25+“, and in words „more than 25“', () => {
    render(<InboundMailWaitingBadge count={25} more />)
    const badge = screen.getByTestId('inbound-mail-badge')
    expect(badge).toHaveTextContent('25+')
    expect(badge).toHaveAccessibleName('More than 25 mails wait to be filed')
  })

  it('shows nothing while nothing waits', () => {
    render(<InboundMailWaitingBadge count={0} more />)
    expect(screen.queryByTestId('inbound-mail-badge')).toBeNull()
  })
})

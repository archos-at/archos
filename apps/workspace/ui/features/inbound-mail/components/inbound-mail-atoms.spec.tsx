import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { MOBILE_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { CheckLine, mailToast } from './inbound-mail-atoms'

const phone = (matches: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query === MOBILE_LAYOUT_QUERY, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

afterEach(() => vi.unstubAllGlobals())

describe('mailToast', () => {
  it('stands a mail’s toast at a phone’s foot, lifted over the decision bar, never over the subject at the top', () => {
    phone(true)
    const action = { label: 'Undo', onClick: () => {} }
    expect(mailToast({ action })).toEqual({ action, position: 'bottom-center', style: { bottom: 'var(--mail-toast-lift, 0px)' } })
  })

  it('leaves a desk’s toast where every toast of the app stands', () => {
    phone(false)
    expect(mailToast({ duration: 10 })).toEqual({ duration: 10 })
  })
})

describe('CheckLine', () => {
  it('ticks from anywhere on its row, which is the label', async () => {
    const change = vi.fn()
    render(
      <CheckLine checked={false} onCheckedChange={change} testId="yes">
        Ja, ich habe diese E-Mail gesendet
      </CheckLine>
    )
    await userEvent.click(screen.getByText('Ja, ich habe diese E-Mail gesendet'))
    expect(change).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('yes-row').className).toContain('pointer-coarse:min-h-11')
  })
})

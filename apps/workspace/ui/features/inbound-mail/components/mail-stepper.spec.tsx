import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import { MailStepper } from './mail-stepper'

const hrefFor = (id: string): string => `/app/projects/p/files/mail/${id}`

describe('MailStepper', () => {
  it('says where the open mail stands and links the one above and below', () => {
    render(<MailStepper ids={['a', 'b', 'c']} openId="b" hrefFor={hrefFor} />)
    expect(screen.getByTestId('inbound-mail-stepper-position')).toHaveTextContent('2 of 3')
    expect(screen.getByRole('link', { name: 'Previous mail' })).toHaveAttribute('href', hrefFor('a'))
    expect(screen.getByRole('link', { name: 'Next mail' })).toHaveAttribute('href', hrefFor('c'))
  })

  it('offers no step past either end, and no stepper for a single mail or one not in the list', () => {
    const { unmount } = render(<MailStepper ids={['a', 'b']} openId="b" hrefFor={hrefFor} />)
    expect(screen.getByTestId('inbound-mail-stepper-next')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Previous mail' })).toBeInTheDocument()
    unmount()
    const { container, unmount: unmountOne } = render(<MailStepper ids={['a']} openId="a" hrefFor={hrefFor} />)
    expect(container).toBeEmptyDOMElement()
    unmountOne()
    const other = render(<MailStepper ids={['a', 'b']} openId="z" hrefFor={hrefFor} />)
    expect(other.container).toBeEmptyDOMElement()
  })
})

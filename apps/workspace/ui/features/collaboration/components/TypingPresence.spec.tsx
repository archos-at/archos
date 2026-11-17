import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import type { DirectoryPerson } from '@/lib/sharing/types'
import { TypingPresence } from './TypingPresence'

const person = (userId: string, name: string): DirectoryPerson =>
  ({ userId, name, email: `${userId}@example.test`, profilePictureUrl: null }) as DirectoryPerson

describe('TypingPresence', () => {
  it('renders nothing when nobody is typing', () => {
    const { container } = render(<TypingPresence typists={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names one colleague', () => {
    render(<TypingPresence typists={[person('u1', 'Anna Berger')]} />)
    expect(screen.getByTestId('typing-presence')).toHaveTextContent('Anna Berger')
  })

  it('names two, in the plural', () => {
    render(
      <TypingPresence typists={[person('u1', 'Anna Berger'), person('u2', 'Tobias Kern')]} />
    )
    const line = screen.getByTestId('typing-presence')
    expect(line).toHaveTextContent('Anna Berger')
    expect(line).toHaveTextContent('Tobias Kern')
    expect(screen.getByRole('status')).toHaveTextContent('are writing')
    expect(screen.getByRole('status')).not.toHaveTextContent('is writing')
  })

  it('joins exactly two names with a conjunction, not a comma', () => {
    render(
      <TypingPresence typists={[person('u1', 'Anna Berger'), person('u2', 'Tobias Kern')]} />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Anna Berger and Tobias Kern are writing…',
    )
  })

  it('keeps the comma when a count follows the names', () => {
    render(
      <TypingPresence
        typists={[
          person('u1', 'Anna Berger'),
          person('u2', 'Tobias Kern'),
          person('u3', 'Lena Fuchs'),
        ]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Anna Berger, Tobias Kern and 1 other are writing…',
    )
  })

  it('inflects the overflow too', () => {
    render(
      <TypingPresence
        typists={[
          person('u1', 'Anna Berger'),
          person('u2', 'Tobias Kern'),
          person('u3', 'Lena Fuchs'),
        ]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('and 1 other are writing')
  })

  it('announces the line exactly once', () => {
    render(<TypingPresence typists={[person('u1', 'Anna Berger')]} />)
    const visible = screen.getByText('Anna Berger is writing…', { selector: 'span[aria-hidden]' })
    expect(visible).toBeInTheDocument()
  })

  it('counts the rest instead of listing them', () => {
    render(
      <TypingPresence
        typists={[
          person('u1', 'Anna Berger'),
          person('u2', 'Tobias Kern'),
          person('u3', 'Lena Fuchs'),
          person('u4', 'Marek Novák'),
        ]}
      />
    )
    const line = screen.getByTestId('typing-presence')
    expect(line).toHaveTextContent('2')
    expect(line).not.toHaveTextContent('Lena Fuchs')
  })

  it('announces politely, once', () => {
    render(<TypingPresence typists={[person('u1', 'Anna Berger')]} />)
    const announcement = screen.getByRole('status')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
  })
})

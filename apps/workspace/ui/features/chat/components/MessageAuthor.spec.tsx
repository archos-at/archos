import { render, screen } from '@/test-utils'
import { describe, test, expect } from 'vitest'
import { MessageAuthor } from './MessageAuthor'
import { avatarColorStyle } from '@/components/ui/avatar-identity'

describe('MessageAuthor', () => {
  test('renders the name and initials for a colleague', () => {
    render(<MessageAuthor userId="user_anna" name="Anna Berger" />)

    expect(screen.getByText('Anna Berger')).toBeInTheDocument()
    expect(screen.getByTestId('message-author-initials')).toHaveTextContent('AB')
  })

  test('names the reader "You" but keeps their real initials', () => {
    render(<MessageAuthor userId="user_me" name="Max Mustermann" isYou />)

    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.queryByText('Max Mustermann')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-author-initials')).toHaveTextContent('MM')
  })

  test('colours the disc from the USER ID, so it survives a rename and a reorder', () => {
    expect(avatarColorStyle('user_anna')).toEqual(avatarColorStyle('user_anna'))
    expect(avatarColorStyle('user_anna')).not.toEqual(avatarColorStyle('user_tobias'))

    render(<MessageAuthor userId="user_anna" name="Anna Berger" />)
    render(<MessageAuthor userId="user_anna" name="A. Berger" />)

    expect(screen.getAllByTestId('message-author-initials')).toHaveLength(2)
  })

  test('prefers a real avatar image when the directory has one', () => {
    render(
      <MessageAuthor userId="user_anna" name="Anna Berger" avatarUrl="https://example.test/a.png" />
    )

    expect(screen.getByTestId('message-author-avatar')).toHaveAttribute(
      'src',
      'https://example.test/a.png'
    )
    expect(screen.queryByTestId('message-author-initials')).not.toBeInTheDocument()
  })

  test('falls back to a neutral disc for a message with no author', () => {
    render(<MessageAuthor />)

    expect(screen.getByTestId('message-author-initials')).toHaveTextContent('?')
  })

  test('labels the whole header once, so the avatar is not announced separately', () => {
    render(<MessageAuthor userId="user_anna" name="Anna Berger" />)

    expect(screen.getByRole('group', { name: 'Message from Anna Berger' })).toBeInTheDocument()
  })

  test('a grouped continuation draws no header but stays attributable', () => {
    render(<MessageAuthor userId="user_anna" name="Anna Berger" grouped />)

    expect(screen.queryByTestId('message-author')).not.toBeInTheDocument()
    expect(screen.getByText('Continued from Anna Berger')).toHaveClass('sr-only')
  })

  test('shows the time next to the name when given one', () => {
    render(<MessageAuthor userId="user_anna" name="Anna Berger" timestamp="2026-07-29T09:05:00Z" />)

    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })
})

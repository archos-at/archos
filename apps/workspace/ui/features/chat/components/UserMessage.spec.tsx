import { render, screen } from '@/test-utils'
import { describe, test, expect } from 'vitest'
import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  test('renders message content', () => {
    render(<UserMessage content="Hello, how can you help me?" />)

    expect(screen.getByText('Hello, how can you help me?')).toBeInTheDocument()
  })

  test('preserves whitespace in content', () => {
    const multilineContent = `Line 1
Line 2
Line 3`

    const { container } = render(<UserMessage content={multilineContent} />)

    const markdown = container.querySelector('.markdown-content')
    expect(markdown?.textContent).toBe(multilineContent)
  })

  test('renders empty content', () => {
    const { container } = render(<UserMessage content="" />)

    expect(container.querySelector('[class*="rounded"]')).toBeInTheDocument()
  })

  test('renders long content', () => {
    const longContent = 'A'.repeat(1000)

    render(<UserMessage content={longContent} />)

    expect(screen.getByText(longContent)).toBeInTheDocument()
  })

  test('renders special characters', () => {
    const { container } = render(<UserMessage content="Code: `const x = 1` and <html> tags" />)

    expect(container.textContent).toContain('Code:')
    expect(container.textContent).toContain('const x = 1')
  })

  test('displays timestamp when provided', () => {
    const timestamp = new Date('2024-01-15T14:30:00')

    render(<UserMessage content="Hello" timestamp={timestamp} />)

    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  test('handles ISO string timestamp', () => {
    render(<UserMessage content="Hello" timestamp="2024-01-15T14:30:00Z" />)

    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  test('does not display timestamp when not provided', () => {
    const { container } = render(<UserMessage content="Hello" />)

    expect(container.querySelectorAll('[class*="text-subtle"]')).toHaveLength(0)
  })

  describe('without an author (solo thread)', () => {
    test('renders the unattributed bubble, with no authorship anywhere', () => {
      render(<UserMessage content="Hello" timestamp={new Date('2026-07-29T09:05:00Z')} />)

      expect(screen.queryByTestId('message-author')).not.toBeInTheDocument()
      expect(screen.queryByTestId('message-author-initials')).not.toBeInTheDocument()
    })
  })

  describe('the role mark', () => {
    test('is not drawn over the bubble, only named for a screen reader', () => {
      render(<UserMessage content="Hello" />)

      const name = screen.getByText('Input')
      expect(name).toHaveClass('sr-only')
      expect(name.closest('.rounded-bubble')).not.toBeNull()
      expect(document.querySelector('.card-eyebrow')).toBeNull()
    })
  })

  describe('with an author (shared thread)', () => {
    test("renders a colleague's name and avatar, without the role tab", () => {
      render(
        <UserMessage
          content="Der Innenhof ist verschlossen."
          author={{ userId: 'user_anna', name: 'Anna Berger' }}
        />
      )

      expect(screen.getByText('Anna Berger')).toBeInTheDocument()
      expect(screen.getByTestId('message-author-initials')).toHaveTextContent('AB')
      expect(screen.queryByText(/^input$/i)).not.toBeInTheDocument()
    })

    test("names the reader's own message 'You'", () => {
      render(
        <UserMessage
          content="Meine Frage"
          author={{ userId: 'user_me', name: 'Max Mustermann', isYou: true }}
        />
      )

      expect(screen.getByText('You')).toBeInTheDocument()
    })

    test('every human message stays on the same side, whoever wrote it', () => {
      const colleague = render(
        <UserMessage content="x" author={{ userId: 'user_anna', name: 'Anna Berger' }} />
      )
      const mine = render(
        <UserMessage content="x" author={{ userId: 'user_me', name: 'Me', isYou: true }} />
      )

      for (const { container } of [colleague, mine]) {
        expect(container.querySelector('.items-end')).toBeInTheDocument()
        expect(container.querySelector('.items-start')).toBeNull()
      }
    })

    test("a colleague's bubble is the same bubble as the reader's own", () => {
      const colleague = render(
        <UserMessage content="x" author={{ userId: 'user_anna', name: 'Anna Berger' }} />
      )
      const mine = render(
        <UserMessage content="x" author={{ userId: 'user_me', name: 'Me', isYou: true }} />
      )

      for (const { container } of [colleague, mine]) {
        expect(container.querySelector('.bg-card')).toBeInTheDocument()
        expect(container.querySelector('.bg-muted\\/45')).toBeNull()
      }
      for (const { container } of [colleague, mine]) {
        expect(container.querySelector('.rounded-bubble')).toBeInTheDocument()
        expect(container.querySelector('.rounded-tr-\\[4px\\]')).toBeInTheDocument()
      }
    })

    test('without `side` an attributed bubble sits at the end, exactly as before', () => {
      const { container } = render(
        <UserMessage content="x" author={{ userId: 'user_anna', name: 'Anna Berger' }} />
      )
      const root = container.querySelector('[data-shared-author]')
      expect(root).toHaveAttribute('data-side', 'end')
      expect(root).toHaveClass('items-end')
      expect(container.querySelector('.rounded-tr-\\[4px\\]')).toBeInTheDocument()
      expect(container.querySelector('.bg-card')).toBeInTheDocument()
      expect(screen.getByTestId('message-author')).toHaveClass('flex-row-reverse')
      expect(container.querySelector('.max-w-\\[85\\%\\]')).toBeNull()
    })

    test('side="start" mirrors the bubble for the other party of a two-party thread', () => {
      const { container } = render(
        <UserMessage content="x" side="start" author={{ userId: 'piloti-team:Matthias', name: 'Matthias' }} />
      )
      const root = container.querySelector('[data-shared-author]')
      expect(root).toHaveAttribute('data-side', 'start')
      expect(root).toHaveClass('items-start')
      expect(root).not.toHaveClass('items-end')
      expect(container.querySelector('.rounded-tl-\\[4px\\]')).toBeInTheDocument()
      expect(container.querySelector('.rounded-tr-\\[4px\\]')).toBeNull()
      expect(container.querySelector('.bg-muted')).toBeInTheDocument()
      expect(screen.getByTestId('message-author')).not.toHaveClass('flex-row-reverse')
      expect(screen.getByRole('button', { name: /copy/i })).toHaveClass('left-2')
      expect(container.querySelector('.max-w-\\[85\\%\\]')).toBeInTheDocument()
    })

    test('a grouped message repeats no header and stays attributable to a screen reader', () => {
      render(
        <UserMessage
          content="Nachtrag"
          author={{ userId: 'user_anna', name: 'Anna Berger' }}
          grouped
          timestamp={new Date('2026-07-29T09:06:00Z')}
        />
      )

      expect(screen.queryByTestId('message-author')).not.toBeInTheDocument()
      expect(screen.getByText('Continued from Anna Berger')).toHaveClass('sr-only')
      expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
    })

    test('renders a structured mention as a chip in the text', () => {
      render(
        <UserMessage
          content="@Anna Berger kannst du den Plan prüfen?"
          author={{ userId: 'user_me', name: 'Me', isYou: true }}
          mentions={[{ targetId: 'user_anna', display: 'Anna Berger' }]}
          currentUserId="user_anna"
        />
      )

      const chip = screen.getByTestId('mention-chip')
      expect(chip).toHaveAttribute('data-mention-target', 'user_anna')
      expect(chip).toHaveTextContent('Anna Berger')
    })

    test('text that merely looks like a mention stays plain text (spec MN-3)', () => {
      render(
        <UserMessage
          content="@Anna Berger kannst du den Plan prüfen?"
          author={{ userId: 'user_me', name: 'Me', isYou: true }}
        />
      )

      expect(screen.queryByTestId('mention-chip')).not.toBeInTheDocument()
    })

    test('renders the message text itself either way', () => {
      render(
        <UserMessage content="Gilt die 40-m-Grenze?" author={{ userId: 'user_anna', name: 'Anna' }} />
      )

      expect(screen.getByText('Gilt die 40-m-Grenze?')).toBeInTheDocument()
    })
  })
})

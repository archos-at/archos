/**
 * @vitest-environment node
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatArrivalProvider, type ChatArrival } from '../hooks/use-thread-phase'
import { ChatArea } from './ChatArea'

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: true, user: null }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/personal/chat',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

const firstPaint = (arrival: ChatArrival): string =>
  renderToString(
    <TooltipProvider>
      <ChatArrivalProvider value={arrival}>
        <ChatArea isAuthenticated={false} />
      </ChatArrivalProvider>
    </TooltipProvider>
  )

describe('an empty chat opened cold paints what it will settle on (the owner, 2026-11-25)', () => {
  test('with no chat to resume, the server paints the greeting and no skeleton', () => {
    const html = firstPaint({ resumes: false, greetingName: 'Anna Berger' })
    expect(html).toContain('data-testid="new-chat-greeting"')
    expect(html).not.toContain('thread-skeleton-overlay')
    expect(html).toContain('Anna')
    expect(html).not.toMatch(/opacity:\s*0/)
    expect(html).not.toContain('invisible')
  })

  test('with a chat to resume, the server paints the skeleton and no greeting', () => {
    const html = firstPaint({ resumes: true, greetingName: 'Anna Berger' })
    expect(html).toContain('thread-skeleton-overlay')
    expect(html).not.toContain('data-testid="new-chat-greeting"')
  })

  test('without a word from the server, the chat keeps the skeleton, as every chat did before', () => {
    expect(firstPaint({})).toContain('thread-skeleton-overlay')
  })

  test('the greeting stands at its settled line in CSS before anything is measured', () => {
    expect(firstPaint({ resumes: false })).toMatch(/padding-bottom:\s*var\(--welcome-offset,\s*round\(nearest,\s*calc\(50cqh \+ 70px\)/)
  })
})

import { render, screen } from '@/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Inbox } from 'lucide-react'
import { EmptyState } from './empty-state'

const pressOn = (path: string): void => {
  window.history.replaceState(null, '', path)
  window.dispatchEvent(new Event('pointerdown'))
}

describe('EmptyState', () => {
  afterEach(() => {
    vi.useRealTimers()
    window.history.replaceState(null, '', '/')
  })

  test('stands at once when it mounts on a page the reader arrived at', () => {
    pressOn('/app/projects/a/chat')
    window.history.replaceState(null, '', '/app/projects/a/files')
    render(<EmptyState icon={Inbox} title="Noch keine Dokumente" data-testid="empty" />)

    const empty = screen.getByTestId('empty')
    expect(empty.className).not.toMatch(/animate-in|fade-in|zoom-in|duration-/)
    expect(empty.querySelector('[aria-hidden="true"]')!.className).not.toMatch(/animate-in|zoom-in/)
  })

  test('fades in on one short step when the reader emptied the list in place', () => {
    pressOn('/app/projects/a/files')
    render(<EmptyState icon={Inbox} title="Keine Treffer" data-testid="empty" />)

    expect(screen.getByTestId('empty')).toHaveClass('animate-in', 'fade-in-0', 'duration-snap', 'ease-out', 'motion-reduce:animate-none')
  })
})

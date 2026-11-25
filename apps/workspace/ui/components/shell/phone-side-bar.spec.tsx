import { act, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, afterEach } from 'vitest'
import { useShellOverlays } from './shell-overlays'
import { useRailSide } from './rail-side'
import { PhoneChatSideRow } from './phone-side-bar'

let pathname = '/app/projects/p1/chat'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

const PROJECTS = [{ id: 'p1', name: 'Project One' }]
const row = (): HTMLElement => document.querySelector('[data-slot="phone-side-bar"]') as HTMLElement
const projectPress = (): HTMLElement | null => document.querySelector('[data-slot="phone-side-project"]')

afterEach(() => {
  pathname = '/app/projects/p1/chat'
  act(() => useRailSide.getState().settle())
  useShellOverlays.setState({ moreSheetOpen: false })
})

describe('PhoneChatSideRow - the side row at the top of the phone chat', () => {
  test('on the chat it carries the Persönlich | Projekt switch and the project’s name, which opens the project list', async () => {
    render(<PhoneChatSideRow projectId="p1" onSide projects={PROJECTS} />)
    expect(within(row()).getByTestId('rail-mode-switch')).toHaveAttribute('data-shown', 'project')
    await userEvent.click(within(row()).getByRole('button', { name: /Project One/ }))
    expect(useShellOverlays.getState()).toMatchObject({ moreSheetOpen: true, moreSheetView: 'projects' })
  })

  test('under Persönlich it carries the switch alone', () => {
    pathname = '/app/personal/chat'
    render(<PhoneChatSideRow projectId={null} onSide projects={PROJECTS} />)
    expect(within(row()).getByTestId('rail-mode-switch')).toHaveAttribute('data-shown', 'personal')
    expect(row().querySelector('[data-project-selector]')).toBeNull()
  })

  test('stays while a side switch is under way, so nothing moves until the new side’s chat lands', () => {
    pathname = '/app/personal/chat'
    const { unmount } = render(<PhoneChatSideRow projectId={null} onSide projects={PROJECTS} />)
    act(() => useRailSide.getState().begin({ mode: 'project', projectId: 'p1' }))
    expect(within(row()).getByTestId('rail-mode-switch')).toHaveAttribute('data-shown', 'project')
    unmount()
    act(() => useRailSide.getState().settle())

    pathname = '/app/projects/p1/chat'
    render(<PhoneChatSideRow projectId="p1" onSide projects={PROJECTS} />)
    act(() => useRailSide.getState().begin({ mode: 'personal', projectId: null }))
    expect(row()).not.toBeNull()
  })

  test('the project’s press stands at once when the chat arrives with it: no fade on the first paint', () => {
    render(<PhoneChatSideRow projectId="p1" onSide projects={PROJECTS} />)
    expect(projectPress()).not.toBeNull()
    expect(projectPress()!.style.opacity).not.toBe('0')
  })

  test('switching to Projekt fades the press in rather than popping it in', () => {
    pathname = '/app/personal/chat'
    render(<PhoneChatSideRow projectId={null} onSide projects={PROJECTS} />)
    expect(projectPress()).toBeNull()
    act(() => useRailSide.getState().begin({ mode: 'project', projectId: 'p1' }))
    expect(projectPress()).not.toBeNull()
    expect(projectPress()!.style.opacity).toBe('0')
  })

  test('stands on no other page, and not on a page with no side', () => {
    for (const [path, onSide] of [['/app/projects/p1/files', true], ['/app/inbox', false], ['/app/projects/p1/chat', false]] as const) {
      pathname = path
      const { unmount } = render(<PhoneChatSideRow projectId="p1" onSide={onSide} projects={PROJECTS} />)
      expect(document.querySelector('[data-slot="phone-chat-side-row"]')).toBeNull()
      unmount()
    }
  })

  test('is a phone row: hidden from `md` up', () => {
    render(<PhoneChatSideRow projectId="p1" onSide projects={PROJECTS} />)
    expect(screen.getByTestId('rail-mode-switch').closest('[data-slot="phone-chat-side-row"]')).toHaveClass('md:hidden', 'shrink-0')
  })
})

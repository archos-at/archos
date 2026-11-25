import { act, render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { RailChatsSource } from './rail-chats'
import { RailModeSwitch } from './rail-mode-switch'
import { useRailSide } from './rail-side'
import { recordRecentProject } from './recent-projects'

const push = vi.hoisted(() => vi.fn())
const prefetch = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, prefetch }) }))

const warm = vi.fn()
const show = (mode: 'personal' | 'project' = 'personal') =>
  render(
    <RailChatsSource value={{ items: [], allHref: '/app/personal/chat', onWarmOtherSide: warm }}>
      <RailModeSwitch mode={mode} collapsed={false} tourAnchor="side-switch" />
    </RailChatsSource>
  )
const thumb = (): HTMLElement => document.querySelector<HTMLElement>('[data-slot="rail-mode-thumb"]')!

beforeEach(() => {
  push.mockReset()
  prefetch.mockReset()
  warm.mockReset()
  act(() => useRailSide.getState().settle())
  recordRecentProject('p1')
})

describe('the Persönlich | Projekt switch moves at once (the rail’s transition)', () => {
  test('a click slides the thumb before the route lands, and navigates once', async () => {
    const user = userEvent.setup()
    show()
    expect(thumb()).not.toHaveClass('translate-x-full')

    await user.click(screen.getByRole('radio', { name: 'Project' }))

    expect(thumb()).toHaveClass('translate-x-full')
    expect(useRailSide.getState().pending).toEqual({ mode: 'project', projectId: 'p1' })
    expect(push.mock.calls).toEqual([['/app/projects/p1/chat']])
  })

  test('an arrow key does what the click does, keeping the focus in the switch', async () => {
    const user = userEvent.setup()
    show()
    screen.getByRole('radio', { name: 'Personal' }).focus()

    await user.keyboard('{ArrowRight}')

    expect(thumb()).toHaveClass('translate-x-full')
    expect(push.mock.calls).toEqual([['/app/projects/p1/chat']])
    expect(screen.getByTestId('rail-mode-switch')).toContainElement(document.activeElement as HTMLElement)
  })

  test('the thumb moves by transform alone, and not at all under reduced motion', () => {
    show()
    expect(thumb()).toHaveClass('transition-[translate,background-color,box-shadow]', 'duration-quick', 'ease-entrance', 'motion-reduce:transition-none')
  })

  test('a hover or a focus warms the other side: its chats and its page', async () => {
    const user = userEvent.setup()
    show()
    await user.hover(screen.getByTestId('rail-mode-switch'))

    expect(warm).toHaveBeenCalled()
    expect(prefetch).toHaveBeenCalledWith('/app/projects/p1/chat')
  })

  test('a modified arrow (Alt+← is the browser’s back) does not switch', async () => {
    const user = userEvent.setup()
    show('project')
    screen.getByRole('radio', { name: 'Project' }).focus()

    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')

    expect(push).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, within } from '@/test-utils'
import { useChatStore } from '@/features/chat/store'
import { view, scriptedRoom, Harness, serve, captureSurface } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('marking on a touch screen', () => {
  const press = (capture: HTMLElement, pointerId: number, at: [number, number], to = at, pointerType = 'mouse') => {
    fireEvent.pointerDown(capture, { button: 0, clientX: at[0], clientY: at[1], pointerId, pointerType })
    fireEvent.pointerMove(capture, { clientX: to[0], clientY: to[1], pointerId, pointerType })
    fireEvent.pointerUp(capture, { clientX: to[0], clientY: to[1], pointerId, pointerType })
  }

  it('sets a point on release, and nothing for a press that travelled: that was a pan', async () => {
    serve([])
    render(<Harness transport={scriptedRoom().transport} />)
    await screen.findByTestId('review-empty')
    await userEvent.click(screen.getByRole('button', { name: 'point tool' }))
    const capture = captureSurface()

    fireEvent.pointerDown(capture, { button: 0, clientX: 80, clientY: 120, pointerId: 1 })
    expect(screen.queryByTestId('review-draft')).toBeNull()
    fireEvent.pointerMove(capture, { clientX: 260, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(capture, { clientX: 260, clientY: 300, pointerId: 1 })
    expect(screen.queryByTestId('review-draft')).toBeNull()

    press(capture, 1, [80, 120], [83, 121])
    expect(await screen.findByTestId('review-draft')).toBeInTheDocument()
  })

  it('gives the page back to two fingers: a second finger cancels the box being drawn', async () => {
    serve([])
    render(<Harness transport={scriptedRoom().transport} />)
    await screen.findByTestId('review-empty')
    await userEvent.click(screen.getByRole('button', { name: 'region tool' }))
    const capture = captureSurface()
    fireEvent.pointerDown(capture, { button: 0, clientX: 80, clientY: 120, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(capture, { button: 0, clientX: 300, clientY: 320, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(capture, { clientX: 320, clientY: 330, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(capture, { clientX: 320, clientY: 330, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerUp(capture, { clientX: 320, clientY: 330, pointerId: 1, pointerType: 'touch' })
    expect(screen.queryByTestId('review-draft')).toBeNull()
  })

  it('returns to navigating once a finger has set its mark, so the next drag scrolls', async () => {
    serve([])
    render(<Harness transport={scriptedRoom().transport} />)
    await screen.findByTestId('review-empty')
    await userEvent.click(screen.getByRole('button', { name: 'region tool' }))
    press(captureSurface(), 1, [80, 120], [320, 300], 'touch')
    expect(await screen.findByTestId('review-draft')).toBeInTheDocument()
    expect(within(screen.getByTestId('sheet')).queryByTestId('review-capture')).toBeNull()
  })

  it('a mouse keeps its tool for the next mark', async () => {
    serve([])
    render(<Harness transport={scriptedRoom().transport} />)
    await screen.findByTestId('review-empty')
    await userEvent.click(screen.getByRole('button', { name: 'region tool' }))
    press(captureSurface(), 1, [80, 120], [320, 300])
    expect(await screen.findByTestId('review-draft')).toBeInTheDocument()
    expect(within(screen.getByTestId('sheet')).getByTestId('review-capture')).toBeInTheDocument()
  })

  it('pins stay 24px on the drawing and catch a finger at 44px', async () => {
    serve([view({ id: 'a', number: 1 })])
    render(<Harness transport={scriptedRoom().transport} />)
    const [pin] = await within(screen.getByTestId('sheet')).findAllByTestId('review-pin')
    expect(pin).toHaveClass('touch-target')
  })
})

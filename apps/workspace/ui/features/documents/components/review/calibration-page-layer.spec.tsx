import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import { CalibrationSheet, captureSurface, clickAt, dragBox, recordingClient, SHEET_BOX } from '@/test-utils/calibration-sheet'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

async function enterLength() {
  fireEvent.change(screen.getByRole('spinbutton', { name: 'True length of the distance' }), { target: { value: '21' } })
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
}

async function setting() {
  render(<CalibrationSheet client={recordingClient().client} />)
  await waitFor(() => expect(screen.getByTestId('scale-button')).toBeEnabled())
  await userEvent.click(screen.getByTestId('scale-button'))
  await userEvent.click(await screen.findByRole('button', { name: 'Set scale' }))
}

describe('the calibration page layer', () => {
  it('takes no clicks until a scale is being set', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await screen.findByRole('button', { name: 'No scale' })
    expect(screen.queryByTestId('calibration-capture')).toBeNull()
  })

  it('sets the two points with the measure line, dashed to the pointer while the second is placed', async () => {
    await setting()
    const capture = captureSurface()
    expect(capture.className).toContain('touch-pan-y')
    clickAt(0.25, 0.5)
    expect(screen.getByTestId('calibration-point-from')).toBeInTheDocument()
    fireEvent.pointerMove(capture, { clientX: 0.6 * SHEET_BOX.width, clientY: 0.5 * SHEET_BOX.height, pointerId: 1 })
    const dashed = screen.getByTestId('calibration-span').querySelectorAll('line[stroke-dasharray="4 3"]')
    expect(dashed).toHaveLength(2)

    clickAt(0.75, 0.5)
    expect(screen.getByTestId('calibration-point-to')).toBeInTheDocument()
    expect(screen.getByTestId('calibration-span').querySelectorAll('line[stroke-dasharray]')).toHaveLength(0)
    expect(captureSurface().className).toContain('touch-pan-y')
    await enterLength()
    expect(captureSurface().className).toContain('touch-none')
  })

  it('lets a placed point be dragged by a hit area wider than its marker, ringed while it moves', async () => {
    await setting()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    const handle = screen.getByTestId('calibration-handle-to')
    expect(handle.className).toContain('pointer-coarse:size-11')
    vi.spyOn(screen.getByTestId('calibration-layer-1'), 'getBoundingClientRect').mockReturnValue(captureSurface().getBoundingClientRect())
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 750, clientY: 350 })
    expect(handle).toHaveAttribute('data-dragging', 'true')
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 800, clientY: 350 })
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 800, clientY: 350 })
    expect(handle).not.toHaveAttribute('data-dragging')
    expect(handle).toHaveStyle({ left: '80%', top: '50%' })
  })

  it('takes a press that travelled for a pan, and a second finger for a pinch', async () => {
    await setting()
    const capture = captureSurface()
    fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(capture, { clientX: 300, clientY: 300, pointerId: 1 })
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()

    fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerDown(capture, { button: 0, clientX: 200, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(capture, { clientX: 200, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(capture, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
  })

  it('draws the frame by dragging once the points and the length are set, and a slip is no frame', async () => {
    await setting()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    expect(screen.queryByTestId('calibration-draft-region')).toBeNull()
    await enterLength()
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.205, y: 0.305 })
    expect(screen.queryByTestId('calibration-draft-region')).toBeNull()
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    expect(screen.getByTestId('calibration-draft-region')).toHaveStyle({ left: '20%', top: '30%' })
    expect(screen.getByTestId('calibration-region-state')).toHaveTextContent('frame in the middle')
  })

  it('lets the draft go when the measure tool is put down', async () => {
    await setting()
    clickAt(0.25, 0.5)
    await userEvent.click(screen.getByRole('button', { name: 'put the tool down' }))
    expect(screen.queryByTestId('calibration-capture')).toBeNull()
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
  })
})

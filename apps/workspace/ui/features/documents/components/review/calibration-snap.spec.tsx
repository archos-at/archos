import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import {
  CalibrationSheet,
  captureSurface,
  clickAt,
  recordingClient,
  SHEET_BOX,
} from '@/test-utils/calibration-sheet'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('@/lib/drawing-tape/snap-wire', async (original) => ({
  ...(await original<typeof import('@/lib/drawing-tape/snap-wire')>()),
  fetchSnapTargets: vi.fn(async () => ({
    vertices: [0.3, 0.5],
    segments: [0.1, 0.8, 0.9, 0.8],
    scales: [],
  })),
}))

async function setting() {
  render(<CalibrationSheet client={recordingClient().client} />)
  await waitFor(() => expect(screen.getByTestId('scale-button')).toBeEnabled())
  await userEvent.click(screen.getByTestId('scale-button'))
  await userEvent.click(await screen.findByRole('button', { name: 'Set scale' }))
}

const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(captureSurface(), {
    clientX: x * SHEET_BOX.width,
    clientY: y * SHEET_BOX.height,
    pointerId: 1,
  })

describe('setting a scale snaps like the tape', () => {
  it('shows the corner under the pointer and puts the first point on it', async () => {
    await setting()
    await waitFor(() => expect(captureSurface()).toBeInTheDocument())
    moveTo(0.5, 0.5)
    moveTo(0.302, 0.502)
    await waitFor(() =>
      expect(screen.getByTestId('calibration-snap-tag')).toHaveTextContent('Corner')
    )
    clickAt(0.302, 0.502)
    expect(screen.getByTestId('calibration-point-from')).toHaveAttribute('x', '30%')
  })

  it('snaps to a line and leaves a free spot alone', async () => {
    await setting()
    moveTo(0.5, 0.5)
    moveTo(0.5, 0.803)
    await waitFor(() =>
      expect(screen.getByTestId('calibration-snap-tag')).toHaveTextContent('on line')
    )
    moveTo(0.6, 0.3)
    await waitFor(() => expect(screen.queryByTestId('calibration-snap-tag')).toBeNull())
    clickAt(0.6, 0.3)
    expect(screen.getByTestId('calibration-point-from')).toHaveAttribute('x', '60%')
  })
})

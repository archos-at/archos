/**
 * The calibrate tool on the page: two clicks set the reference points as shares
 * of the page, the region is the stored one when both lie in it and otherwise a
 * box the person drags, and what is saved is drawn where it holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import {
  CalibrationSheet,
  calibrationView,
  captureSurface,
  clickAt,
  dragBox,
  recordingClient,
  SHEET_BOX,
} from '@/test-utils/calibration-sheet'

beforeEach(() => vi.restoreAllMocks())

/** The tool taken up from the panel's chip and its button, as a person does. */
async function takeTool() {
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('calibration-chip'))
  await user.click(screen.getByTestId('calibration-start'))
  return user
}

describe('CalibrationPageLayer', () => {
  it('renders nothing where the organization does not hold the feature', async () => {
    const { client, list } = recordingClient([calibrationView()])
    render(<CalibrationSheet client={client} flag={false} />)
    await Promise.resolve()
    expect(screen.queryByTestId('calibration-layer-1')).toBeNull()
    expect(screen.queryByTestId('calibration-chip')).toBeNull()
    expect(screen.queryByTestId('calibration-panel')).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('offers no surface to click on until the tool is in hand', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await screen.findByTestId('calibration-chip')
    expect(screen.queryByTestId('calibration-capture')).toBeNull()
    await takeTool()
    expect(screen.getByTestId('calibration-capture')).toBeInTheDocument()
  })

  it('sets the two reference points with two clicks, where they were clicked', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await takeTool()

    clickAt(0.25, 0.5)
    expect(screen.getByTestId('calibration-point-from')).toHaveStyle({ left: '25%', top: '50%' })
    expect(screen.queryByTestId('calibration-point-to')).toBeNull()

    clickAt(0.75, 0.5)
    expect(screen.getByTestId('calibration-point-to')).toHaveStyle({ left: '75%', top: '50%' })
  })

  it('takes a press that travelled for a pan, not a point', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await takeTool()
    const capture = captureSurface()
    fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(capture, { clientX: 180, clientY: 100, pointerId: 1 })
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
  })

  it('takes a second finger for a pinch, not a point', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await takeTool()
    const capture = captureSurface()
    fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerDown(capture, { button: 0, clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(capture, { clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(capture, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
  })

  it('has the region drawn by a drag once both points are set, and draws it with the ratio', async () => {
    const user = await (async () => {
      render(<CalibrationSheet client={recordingClient().client} />)
      return takeTool()
    })()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    expect(screen.queryByTestId('calibration-draft-region')).toBeNull()

    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    const region = screen.getByTestId('calibration-draft-region')
    expect(region.style.left).toBe('20%')
    expect(region.style.top).toBe('30%')
    expect(Number.parseFloat(region.style.width)).toBeCloseTo(60, 3)
    expect(Number.parseFloat(region.style.height)).toBeCloseTo(40, 3)

    await user.type(screen.getByRole('spinbutton'), '21,0{Enter}')
    await waitFor(() => expect(region).toHaveTextContent('1:100'))
    expect(screen.getByTestId('calibration-span-length')).toHaveTextContent('21 m')
  })

  it('ignores a box too small to be a region', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    dragBox({ x: 0.5, y: 0.5 }, { x: 0.5 + 4 / SHEET_BOX.width, y: 0.5 + 4 / SHEET_BOX.height })
    expect(screen.queryByTestId('calibration-draft-region')).toBeNull()
  })

  it('takes the stored region when both points lie in it: nothing is drawn, and a drag changes nothing', async () => {
    const stored = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }
    render(<CalibrationSheet client={recordingClient().client} storedRegions={{ 1: [stored] }} />)
    await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)

    const region = screen.getByTestId('calibration-draft-region')
    expect(region).toHaveStyle({ left: '10%', top: '20%', width: '80%', height: '60%' })
    dragBox({ x: 0.3, y: 0.4 }, { x: 0.9, y: 0.9 })
    expect(screen.getByTestId('calibration-draft-region')).toHaveStyle({ left: '10%', top: '20%', width: '80%', height: '60%' })
    expect(screen.getByTestId('calibration-region-state')).toHaveTextContent('the area the drawing defines')
  })

  it('draws a saved calibration where it holds, with the ratio the page gives it, once the panel is open', async () => {
    const saved = calibrationView()
    render(<CalibrationSheet client={recordingClient([saved]).client} />)
    const chip = await screen.findByTestId('calibration-chip')
    expect(screen.queryByTestId(`calibration-region-${saved.id}`)).toBeNull()
    await userEvent.setup().click(chip)
    const region = screen.getByTestId(`calibration-region-${saved.id}`)
    expect(region).toHaveStyle({ left: '10%', top: '10%', width: '80%', height: '80%' })
    expect(region).toHaveTextContent('1:100')
  })
})

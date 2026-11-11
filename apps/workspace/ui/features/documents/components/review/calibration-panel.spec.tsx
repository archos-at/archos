/**
 * The scale beside the page: the ratio shown before saving, the one reason
 * saving is not possible yet, one set call with shares of the page, the list of
 * what is active, and a withdraw that is confirmed and returns the page to its
 * earlier state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@/test-utils'
import {
  CalibrationSheet,
  calibrationView,
  clickAt,
  dragBox,
  recordingClient,
  SHEET_DOCUMENT,
} from '@/test-utils/calibration-sheet'

beforeEach(() => vi.restoreAllMocks())

async function takeTool() {
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('calibration-chip'))
  await user.click(screen.getByTestId('calibration-start'))
  return user
}

describe('CalibrationPanel', () => {
  it('states the page’s scale on its chip: none, the ratio, or how many', async () => {
    const { unmount } = render(<CalibrationSheet client={recordingClient().client} />)
    expect(await screen.findByTestId('calibration-chip')).toHaveTextContent('Scale not calibrated')
    unmount()

    const one = render(<CalibrationSheet client={recordingClient([calibrationView()]).client} />)
    await waitFor(() => expect(screen.getByTestId('calibration-chip')).toHaveTextContent('Scale 1:100'))
    one.unmount()

    const second = calibrationView({ id: '55555555-5555-4555-8555-555555555555', region: { x: 0.6, y: 0.1, w: 0.3, h: 0.3 } })
    render(<CalibrationSheet client={recordingClient([calibrationView(), second]).client} />)
    await waitFor(() => expect(screen.getByTestId('calibration-chip')).toHaveTextContent('2 scales calibrated'))
  })

  it('shows the ratio two clicks and a length give, before anything is saved', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const user = await takeTool()
    expect(screen.getByTestId('calibration-next')).toHaveTextContent('Click the start of a span whose length you know')
    expect(screen.getByTestId('calibration-ratio')).toHaveTextContent('–')

    // Half of a page 1190.55 pt wide is 210 mm of paper; 21.0 m across it is 1:100.
    clickAt(0.25, 0.5)
    expect(screen.getByTestId('calibration-points')).toHaveTextContent('1 of 2 points')
    clickAt(0.75, 0.5)
    expect(screen.getByTestId('calibration-points')).toHaveTextContent('2 points set')
    // A comma, as people here type a decimal.
    await user.type(screen.getByRole('spinbutton', { name: 'True length of the span in metres' }), '21,0{Enter}')

    expect(screen.getByTestId('calibration-ratio')).toHaveTextContent('1:100')
    expect(set).not.toHaveBeenCalled()
  })

  it('cannot save while the region is missing, and says in one line why', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const user = await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    await user.type(screen.getByRole('spinbutton'), '21{Enter}')

    const save = screen.getByTestId('calibration-save')
    expect(save).toBeDisabled()
    expect(screen.getByTestId('calibration-region-state')).toHaveTextContent('Still missing')
    const why = screen.getByTestId('calibration-next')
    expect(why).toHaveTextContent('Drag a frame around the drawing the scale holds for. It must contain both points.')
    expect(save).toHaveAttribute('aria-describedby', why.id)
    await user.click(save)
    expect(set).not.toHaveBeenCalled()
  })

  it('says so when the drawn region misses a point, and still cannot save', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    const user = await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    await user.type(screen.getByRole('spinbutton'), '21{Enter}')
    dragBox({ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.7 })
    expect(screen.getByTestId('calibration-next')).toHaveTextContent('The frame does not contain both points. Drag it again.')
    expect(screen.getByTestId('calibration-save')).toBeDisabled()
  })

  it('saves once, with shares of the page, puts the tool down and lists what was saved', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const user = await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    await user.type(screen.getByRole('spinbutton'), '21,0{Enter}')
    expect(screen.queryByTestId('calibration-next')).toBeNull()

    await user.dblClick(screen.getByTestId('calibration-save'))

    await waitFor(() => expect(screen.getByTestId('tool-in-hand')).toHaveTextContent('select'))
    expect(set).toHaveBeenCalledTimes(1)
    const [documentId, sent] = set.mock.calls[0] ?? []
    expect(documentId).toBe(SHEET_DOCUMENT)
    expect(sent).toMatchObject({ page: 1, from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 }, lengthM: 21 })
    expect(sent?.region.x).toBeCloseTo(0.2, 6)
    expect(sent?.region.y).toBeCloseTo(0.3, 6)
    expect(sent?.region.w).toBeCloseTo(0.6, 6)
    expect(sent?.region.h).toBeCloseTo(0.4, 6)
    // Every place is a share of the page: nothing in pixels or points leaves the browser.
    for (const share of [sent?.region.x, sent?.region.y, sent?.region.w, sent?.region.h]) {
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThanOrEqual(1)
    }
    const rows = within(screen.getByTestId('calibration-list')).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('1:100')
    expect(rows[0]).toHaveTextContent('Span 21 m')
    expect(rows[0]).toHaveTextContent('You')
  })

  it('lets go of what was being set when the person cancels', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const user = await takeTool()
    clickAt(0.25, 0.5)
    await user.click(screen.getByTestId('calibration-cancel'))
    expect(screen.getByTestId('tool-in-hand')).toHaveTextContent('select')
    expect(screen.queryByTestId('calibration-form')).toBeNull()
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })

  it('sets the points anew on request and keeps the length typed', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    const user = await takeTool()
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    await user.type(screen.getByRole('spinbutton'), '21{Enter}')
    await user.click(screen.getByTestId('calibration-reset-points'))
    expect(screen.getByTestId('calibration-points')).toHaveTextContent('No point yet')
    expect(screen.getByRole('spinbutton')).toHaveValue('21')
  })

  it('lists who set a calibration and when, and withdraws it only after a confirmation', async () => {
    const saved = calibrationView()
    const { client, withdraw } = recordingClient([saved])
    render(<CalibrationSheet client={client} />)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('calibration-chip'))

    const row = screen.getByTestId(`calibration-row-${saved.id}`)
    expect(row).toHaveTextContent('1:100')
    expect(row).toHaveTextContent('Anna Berger')
    expect(within(row).getByRole('time')).toHaveAttribute('datetime', saved.createdAt)

    await user.click(within(row).getByTestId('calibration-withdraw'))
    expect(withdraw).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Withdraw scale 1:100?')

    await user.click(screen.getByTestId('calibration-withdraw-confirm'))

    // The page is as it was before the calibration: none listed, none drawn.
    await waitFor(() => expect(screen.queryByTestId(`calibration-row-${saved.id}`)).toBeNull())
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect(withdraw).toHaveBeenCalledWith(SHEET_DOCUMENT, saved.id)
    expect(screen.getByTestId('calibration-none')).toHaveTextContent('No scale is calibrated on this page.')
    expect(screen.queryByTestId(`calibration-region-${saved.id}`)).toBeNull()
  })

  it('keeps the calibration when the person backs out of withdrawing it', async () => {
    const saved = calibrationView()
    const { client, withdraw } = recordingClient([saved])
    render(<CalibrationSheet client={client} />)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('calibration-chip'))
    await user.click(screen.getByTestId('calibration-withdraw'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(withdraw).not.toHaveBeenCalled()
    expect(screen.getByTestId(`calibration-row-${saved.id}`)).toBeInTheDocument()
  })

  it('shows a reader who may not calibrate the scale, without the controls, and why', async () => {
    const saved = calibrationView()
    render(<CalibrationSheet client={recordingClient([saved], false).client} />)
    await userEvent.setup().click(await screen.findByTestId('calibration-chip'))
    expect(screen.getByTestId(`calibration-row-${saved.id}`)).toHaveTextContent('1:100')
    expect(screen.queryByTestId('calibration-withdraw')).toBeNull()
    expect(screen.queryByTestId('calibration-start')).toBeNull()
    expect(screen.getByTestId('calibration-not-allowed')).toHaveTextContent('You cannot calibrate the scale here.')
  })

  it('folds back to its chip, and puts the tool down with it', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    const user = await takeTool()
    await user.click(screen.getByTestId('calibration-close'))
    expect(screen.getByTestId('tool-in-hand')).toHaveTextContent('select')
    expect(screen.getByTestId('calibration-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('calibration-panel')).toBeNull()
  })
})

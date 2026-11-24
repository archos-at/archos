import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { CalibrationSheet, calibrationView, clickAt, dragBox, recordingClient, SHEET_DOCUMENT } from '@/test-utils/calibration-sheet'
import { CalibrationRequestError } from '@/lib/drawing-calibrations/client'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const openPopover = async () => {
  await waitFor(() => expect(screen.getByTestId('scale-button')).toBeEnabled())
  await userEvent.click(screen.getByTestId('scale-button'))
  return screen.findByTestId('scale-popover')
}

const typeLength = (value: string) => {
  const field = screen.getByRole('spinbutton', { name: 'True length of the distance' })
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

const step = () => screen.getByTestId('calibration-steps').getAttribute('data-step')

async function walkTo(frame: { from: { x: number; y: number }; to: { x: number; y: number } } | 'page', length = '21') {
  clickAt(0.25, 0.5)
  clickAt(0.75, 0.5)
  typeLength(length)
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  if (frame === 'page') await userEvent.click(screen.getByRole('button', { name: 'Whole page' }))
  else dragBox(frame.from, frame.to)
  return screen.findByTestId('calibration-form')
}

const FRAME = { from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } }

describe('the scale control of the measure mode', () => {
  it('states the page’s scale on the strip, and „No scale“ where it has none', async () => {
    const { client } = recordingClient()
    render(<CalibrationSheet client={client} />)
    expect(await screen.findByRole('button', { name: 'No scale' })).toBeInTheDocument()
    const popover = await openPopover()
    expect(within(popover).getByTestId('calibration-none')).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Set scale' })).toBeInTheDocument()
  })

  it('lists each scale as a row with its length, frame and author, and its regions only while open', async () => {
    const saved = calibrationView()
    render(<CalibrationSheet client={recordingClient([saved]).client} />)
    expect(await screen.findByRole('button', { name: 'Scale 1:100' })).toBeInTheDocument()
    expect(screen.queryByTestId(`calibration-region-${saved.id}`)).toBeNull()
    const popover = await openPopover()
    const row = within(popover).getByTestId(`calibration-row-${saved.id}`)
    expect(row).toHaveTextContent('1:100')
    expect(row).toHaveTextContent(/21(\.00)? m/)
    expect(row).toHaveTextContent('frame in the middle')
    expect(row).toHaveTextContent('Anna Berger')
    const region = screen.getByTestId(`calibration-region-${saved.id}`)
    expect(region).toHaveAttribute('data-tone', 'quiet')
    fireEvent.pointerEnter(row)
    expect(region).toHaveAttribute('data-tone', 'emphasis')
  })

  it('walks two clicks, the length and a frame in a slim step bar, then shows the ratio before saving', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    expect(within(popover).getByTestId('calibration-steps')).toHaveTextContent('Step 1 of 3')
    expect(within(popover).getByTestId('calibration-next')).toHaveTextContent('Click the start')
    expect(within(popover).queryByRole('button', { name: 'Save' })).toBeNull()

    clickAt(0.25, 0.5)
    expect(step()).toBe('secondPoint')
    clickAt(0.75, 0.5)
    expect(screen.getByTestId('calibration-point-to')).toBeInTheDocument()
    expect(step()).toBe('length')
    expect(screen.getByRole('spinbutton', { name: 'True length of the distance' })).toHaveFocus()
    typeLength('21')
    expect(screen.getByTestId('calibration-length-gives')).toHaveTextContent('gives 1:100')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(step()).toBe('region')
    expect(screen.getByTestId('calibration-steps')).toHaveTextContent('Step 3 of 3')
    expect(screen.queryByTestId('calibration-handle-from')).toBeNull()
    dragBox(FRAME.from, FRAME.to)
    const form = await screen.findByTestId('calibration-form')
    expect(within(form).getByTestId('calibration-ratio')).toHaveTextContent('1:100')
    expect(set).not.toHaveBeenCalled()

    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]?.[0]).toBe(SHEET_DOCUMENT)
    expect(set.mock.calls[0]?.[1]).toMatchObject({ page: 1, from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 }, lengthM: 21 })
    expect(await screen.findByRole('button', { name: 'Scale 1:100' })).toBeInTheDocument()
    expect(screen.queryByTestId('calibration-form')).toBeNull()
    expect(screen.getByTestId('calibration-said')).toHaveTextContent('Scale 1:100 set')
  })

  it('offers the standard scale a hand-clicked span is close to, and saves it exactly', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    const form = await walkTo(FRAME, '21.4')
    expect(within(form).getByTestId('calibration-ratio')).toHaveTextContent('1:102')
    await userEvent.click(within(form).getByRole('button', { name: 'Use 1:100' }))
    expect(within(form).getByTestId('calibration-ratio')).toHaveTextContent('1:100')
    expect(within(form).queryByRole('button', { name: 'Use 1:100' })).toBeNull()
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]?.[1]).toMatchObject({ lengthM: 21 })
  })

  it('shows a partial overlap beside the frame before saving, and blocks the save', async () => {
    const other = calibrationView({ region: { x: 0.5, y: 0.1, w: 0.45, h: 0.4 }, from: { x: 0.6, y: 0.2 }, to: { x: 0.9, y: 0.2 }, lengthM: 3.6 })
    const { client, set } = recordingClient([other])
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    const form = await walkTo(FRAME)
    expect(within(form).getByTestId('calibration-overlaps')).toHaveTextContent(/cuts across scale 1:\d+/)
    expect(within(form).getByTestId('calibration-save-reason')).toHaveTextContent('Change the frame first')
    expect(within(form).getByRole('button', { name: 'Save' })).toHaveAccessibleDescription('Change the frame first')
    expect(screen.getByTestId('calibration-draft-region')).toHaveAttribute('data-tone', 'refused')
    expect(screen.getByTestId(`calibration-region-${other.id}`)).toHaveAttribute('data-tone', 'emphasis')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(set).not.toHaveBeenCalled()
  })

  it('says so beside the frame when the server refuses an overlap the list did not show', async () => {
    const { client, set } = recordingClient()
    set.mockRejectedValueOnce(new CalibrationRequestError(409, 'region-overlaps', 'overlaps', '99999999-9999-4999-8999-999999999999'))
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    const form = await walkTo(FRAME)
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByTestId('calibration-overlaps')).toHaveTextContent('another scale on this page')
  })

  it('steps back with Esc and with Back, and leaves the setting only from the first step', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    await walkTo('page')
    expect(screen.getByTestId('calibration-region-state')).toHaveTextContent('whole page')
    await userEvent.keyboard('{Escape}')
    expect(step()).toBe('region')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(step()).toBe('length')
    await userEvent.keyboard('{Escape}')
    expect(step()).toBe('secondPoint')
    await userEvent.keyboard('{Escape}')
    expect(step()).toBe('firstPoint')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('calibration-steps')).toBeNull()
    expect(screen.getByTestId('calibration-start')).toBeInTheDocument()
  })

  it('cancels from any step with the cross, and keeps the draft when the strip button is pressed', async () => {
    render(<CalibrationSheet client={recordingClient().client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    clickAt(0.25, 0.5)
    await userEvent.click(screen.getByTestId('scale-button'))
    expect(step()).toBe('secondPoint')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('calibration-steps')).toBeNull()
    expect(screen.queryByTestId('calibration-point-from')).toBeNull()
  })

  it('tells two scales apart in their rows, and lights a row’s frame on a tap', async () => {
    const page = calibrationView({ region: { x: 0, y: 0, w: 1, h: 1 } })
    const detail = calibrationView({
      id: '55555555-5555-4555-8555-555555555555',
      region: { x: 0.7, y: 0.05, w: 0.25, h: 0.25 },
      from: { x: 0.75, y: 0.1 },
      to: { x: 0.85, y: 0.1 },
      lengthM: 1.2,
    })
    render(<CalibrationSheet client={recordingClient([page, detail]).client} />)
    const popover = await openPopover()
    expect(within(popover).getByTestId(`calibration-row-${page.id}`)).toHaveTextContent('whole page')
    const row = within(popover).getByTestId(`calibration-row-${detail.id}`)
    expect(row).toHaveTextContent(/Detail in the 1:\d+ frame, top right/)
    fireEvent.click(row)
    expect(screen.getByTestId(`calibration-region-${detail.id}`)).toHaveAttribute('data-tone', 'emphasis')
  })

  it('shows the frames of several scales, labelled, while measuring, and stays quiet with one', async () => {
    const page = calibrationView({ region: { x: 0, y: 0, w: 1, h: 1 } })
    const detail = calibrationView({ id: '55555555-5555-4555-8555-555555555555', region: { x: 0.7, y: 0.05, w: 0.25, h: 0.25 } })
    const { unmount } = render(<CalibrationSheet client={recordingClient([page]).client} />)
    await screen.findByRole('button', { name: /^Scale 1:/ })
    expect(screen.queryByTestId(`calibration-region-${page.id}`)).toBeNull()
    unmount()

    render(<CalibrationSheet client={recordingClient([page, detail]).client} />)
    await screen.findByRole('button', { name: /^Scale 1:\d+ · 1:\d+$/ })
    const frame = screen.getByTestId(`calibration-region-${detail.id}`)
    expect(frame).toHaveAttribute('data-tone', 'quiet')
    expect(frame).toHaveTextContent(/^1:\d+$/)
    await userEvent.click(screen.getByRole('button', { name: 'put the tool down' }))
    expect(screen.queryByTestId(`calibration-region-${detail.id}`)).toBeNull()
  })

  it('removes a row without asking, and offers the undo in a toast', async () => {
    const saved = calibrationView()
    const { client, withdraw } = recordingClient([saved])
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Remove scale 1:100' }))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(SHEET_DOCUMENT, saved.id))
    expect(toast).toHaveBeenCalledWith(
      'Scale 1:100 removed',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Undo' }),
        classNames: expect.objectContaining({ actionButton: expect.stringContaining('pointer-coarse:min-h-11') }),
      })
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows a reader who may not calibrate the scales without their controls', async () => {
    render(<CalibrationSheet client={recordingClient([calibrationView()], false).client} />)
    const popover = await openPopover()
    expect(within(popover).queryByRole('button', { name: /remove/i })).toBeNull()
    expect(within(popover).queryByRole('button', { name: 'Set scale' })).toBeNull()
    expect(within(popover).getByTestId('calibration-not-allowed')).toBeInTheDocument()
  })
})

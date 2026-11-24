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

  it('sets a scale from two clicks, a frame and a length, showing the ratio before saving', async () => {
    const { client, set } = recordingClient()
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    expect(within(popover).getByTestId('calibration-next')).toHaveTextContent('Click the start')
    const save = within(popover).getByRole('button', { name: 'Save' })
    expect(save).toHaveAttribute('aria-disabled', 'true')

    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    expect(screen.getByTestId('calibration-point-to')).toBeInTheDocument()
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    typeLength('21')
    await waitFor(() => expect(within(popover).getByTestId('calibration-ratio')).toHaveTextContent('1:100'))
    expect(set).not.toHaveBeenCalled()

    await userEvent.click(save)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]?.[0]).toBe(SHEET_DOCUMENT)
    expect(set.mock.calls[0]?.[1]).toMatchObject({ page: 1, from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 }, lengthM: 21 })
    expect(await screen.findByRole('button', { name: 'Scale 1:100' })).toBeInTheDocument()
    expect(screen.queryByTestId('calibration-form')).toBeNull()
    expect(screen.getByTestId('calibration-said')).toHaveTextContent('Scale 1:100 set')
  })

  it('shows a partial overlap beside the frame before saving, and blocks the save', async () => {
    const other = calibrationView({ region: { x: 0.5, y: 0.1, w: 0.45, h: 0.4 }, from: { x: 0.6, y: 0.2 }, to: { x: 0.9, y: 0.2 }, lengthM: 3.6 })
    const { client, set } = recordingClient([other])
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    typeLength('21')
    expect(await within(popover).findByTestId('calibration-overlaps')).toHaveTextContent(/cuts across scale 1:\d+/)
    expect(screen.getByTestId('calibration-draft-region')).toHaveAttribute('data-tone', 'refused')
    expect(screen.getByTestId(`calibration-region-${other.id}`)).toHaveAttribute('data-tone', 'emphasis')
    await userEvent.click(within(popover).getByRole('button', { name: 'Save' }))
    expect(set).not.toHaveBeenCalled()
  })

  it('says so beside the frame when the server refuses an overlap the list did not show', async () => {
    const { client, set } = recordingClient()
    set.mockRejectedValueOnce(new CalibrationRequestError(409, 'region-overlaps', 'overlaps', '99999999-9999-4999-8999-999999999999'))
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Set scale' }))
    clickAt(0.25, 0.5)
    clickAt(0.75, 0.5)
    dragBox({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 })
    typeLength('21')
    await userEvent.click(within(popover).getByRole('button', { name: 'Save' }))
    expect(await within(popover).findByTestId('calibration-overlaps')).toHaveTextContent('another scale on this page')
  })

  it('removes a row without asking, and offers the undo in a toast', async () => {
    const saved = calibrationView()
    const { client, withdraw } = recordingClient([saved])
    render(<CalibrationSheet client={client} />)
    const popover = await openPopover()
    await userEvent.click(within(popover).getByRole('button', { name: 'Remove scale 1:100' }))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(SHEET_DOCUMENT, saved.id))
    expect(toast).toHaveBeenCalledWith('Scale 1:100 removed', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
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

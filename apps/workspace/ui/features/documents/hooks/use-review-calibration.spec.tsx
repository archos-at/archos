import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { act, renderHook, waitFor } from '@/test-utils'
import { calibrationView, recordingClient, SHEET_DOCUMENT, SHEET_SIZE } from '@/test-utils/calibration-sheet'
import { CalibrationRequestError, type CalibrationClient } from '@/lib/drawing-calibrations/client'
import { useReviewCalibration, type CalibrationHost } from './use-review-calibration'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const FROM = { x: 0.25, y: 0.5 }
const TO = { x: 0.75, y: 0.5 }
const BOX = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }

beforeEach(() => vi.mocked(toast).mockClear())

function mount(client: CalibrationClient, options: { load?: CalibrationHost['load']; tool?: CalibrationHost['tool'] } = {}) {
  const { load = 'ready', tool = 'measure' } = options
  return renderHook(
    ({ tool: held }: { tool: CalibrationHost['tool'] }) =>
      useReviewCalibration({ documentId: SHEET_DOCUMENT, load, tool: held, me: 'user_me', annotations: [] }, { client }),
    { initialProps: { tool } }
  )
}

async function complete(hook: ReturnType<typeof mount>) {
  await waitFor(() => expect(hook.result.current.shown).toBe(true))
  act(() => {
    hook.result.current.reportPageSize(1, SHEET_SIZE)
    hook.result.current.beginSetting(1)
  })
  act(() => {
    hook.result.current.pick(1, FROM)
    hook.result.current.pick(1, TO)
    hook.result.current.setLength(21)
    hook.result.current.drawRegion(1, BOX)
  })
}

describe('useReviewCalibration', () => {
  it('steps back one step at a time, and leaves the setting only from the first', async () => {
    const hook = mount(recordingClient().client)
    await complete(hook)
    const steps = [hook.result.current.step]
    for (let i = 0; i < 5; i++) {
      act(() => hook.result.current.back())
      steps.push(hook.result.current.step)
    }
    expect(steps).toEqual(['review', 'region', 'length', 'secondPoint', 'firstPoint', null])
    expect(hook.result.current.setting).toBe(false)
  })

  it('takes the whole page as the frame only when asked, and moves a placed point', async () => {
    const hook = mount(recordingClient().client)
    await complete(hook)
    act(() => hook.result.current.back())
    expect(hook.result.current.draft?.region).toBeNull()
    act(() => hook.result.current.wholePage())
    expect(hook.result.current.draft?.region).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    act(() => hook.result.current.movePoint('to', { x: 0.7, y: 0.5 }))
    expect(hook.result.current.draft?.to).toEqual({ x: 0.7, y: 0.5 })
  })

  it('asks for nothing until the measure tool is first in hand, then keeps the list', async () => {
    const { client, list } = recordingClient([calibrationView()])
    const hook = mount(client, { tool: 'select' })
    await act(async () => {})
    expect(list).not.toHaveBeenCalled()
    expect(hook.result.current.shown).toBe(false)
    hook.rerender({ tool: 'measure' })
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    hook.rerender({ tool: 'select' })
    expect(hook.result.current.shown).toBe(true)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('waits for the review to have read the document, and shows nothing when the list does not answer', async () => {
    const { client, list } = recordingClient()
    mount(client, { load: 'loading' })
    await act(async () => {})
    expect(list).not.toHaveBeenCalled()

    list.mockRejectedValueOnce(new Error('feature_disabled'))
    const hook = mount(client)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.shown).toBe(false)
  })

  it('labels the page by both its scales, counts three or more, and names a page without one', async () => {
    const big = calibrationView()
    const detail = calibrationView({ id: '55555555-5555-4555-8555-555555555555', region: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, lengthM: 4.2 })
    const third = calibrationView({ id: '77777777-7777-4777-8777-777777777777', region: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, lengthM: 10.5 })
    const hook = mount(recordingClient([detail, big]).client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    expect(hook.result.current.labelFor(1)).toBe('2 scales')
    act(() => hook.result.current.reportPageSize(1, SHEET_SIZE))
    expect(hook.result.current.onPage(1)).toEqual([big, detail])
    expect(hook.result.current.labelFor(1)).toBe('Scale 1:100 · 1:20')
    expect(hook.result.current.labelFor(2)).toBe('No scale')

    const three = mount(recordingClient([big, detail, third]).client)
    await waitFor(() => expect(three.result.current.shown).toBe(true))
    act(() => three.result.current.reportPageSize(1, SHEET_SIZE))
    expect(three.result.current.labelFor(1)).toBe('3 scales')
  })

  it('saves a scale for every page with the page size, and shows it on every page', async () => {
    const { client, set } = recordingClient()
    const hook = mount(client)
    await complete(hook)
    act(() => hook.result.current.wholeDocument())
    await act(async () => {
      await hook.result.current.save()
    })
    expect(set).toHaveBeenCalledWith(
      SHEET_DOCUMENT,
      expect.objectContaining({ scope: 'document', pageSize: { widthPt: SHEET_SIZE.width, heightPt: SHEET_SIZE.height } })
    )
    const saved = hook.result.current.calibrations.find((entry) => entry.scope === 'document')
    expect(saved).toBeDefined()
    expect(hook.result.current.onPage(7)).toContain(saved)
    expect(hook.result.current.labelFor(7)).toBe('Scale 1:100')
  })

  it('offers no setting to a reader who may not calibrate', async () => {
    const hook = mount(recordingClient([], false).client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    act(() => hook.result.current.beginSetting(1))
    expect(hook.result.current.setting).toBe(false)
  })

  it('shows the ratio before saving, saves once with shares of the page, and stays in the measure mode', async () => {
    const { client, set } = recordingClient()
    const hook = mount(client)
    await complete(hook)
    expect(hook.result.current.proposal).toMatchObject({ ratio: '1:100', blocked: null })
    await act(async () => {
      await Promise.all([hook.result.current.save(), hook.result.current.save()])
    })
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(SHEET_DOCUMENT, { page: 1, region: BOX, from: FROM, to: TO, lengthM: 21, scope: 'page' })
    expect(hook.result.current).toMatchObject({ setting: false, open: true, said: 'Scale 1:100 set' })
    expect(hook.result.current.calibrations).toHaveLength(1)
  })

  it('keeps the draft and names the scale the server says the frame overlaps', async () => {
    const other = calibrationView({ id: '66666666-6666-4666-8666-666666666666' })
    const { client, set } = recordingClient()
    set.mockRejectedValueOnce(new CalibrationRequestError(409, 'region-overlaps', 'overlaps', other.id))
    const hook = mount(client)
    await complete(hook)
    await act(async () => {
      expect(await hook.result.current.save()).toBe(false)
    })
    expect(hook.result.current.saveFailure).toEqual({ kind: 'overlaps', overlapping: other.id })
    expect(hook.result.current.draft).toMatchObject({ from: FROM, to: TO, region: BOX })
    act(() => hook.result.current.drawRegion(1, { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }))
    expect(hook.result.current.saveFailure).toBeNull()
  })

  it('says a save failed for any other reason', async () => {
    const { client, set } = recordingClient()
    set.mockRejectedValueOnce(new Error('offline'))
    const hook = mount(client)
    await complete(hook)
    await act(async () => {
      await hook.result.current.save()
    })
    expect(hook.result.current.saveFailure).toEqual({ kind: 'failed' })
  })

  it('removes a scale with an undo that sets the same one again', async () => {
    const kept = calibrationView()
    const { client, withdraw, set } = recordingClient([kept])
    const hook = mount(client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    act(() => hook.result.current.reportPageSize(1, SHEET_SIZE))
    await act(async () => {
      expect(await hook.result.current.withdraw(kept)).toBe(true)
    })
    expect(withdraw).toHaveBeenCalledWith(SHEET_DOCUMENT, kept.id)
    expect(hook.result.current.calibrations).toEqual([])
    const [message, options] = vi.mocked(toast).mock.calls[0] ?? []
    expect(message).toBe('Scale 1:100 removed')
    const action = (options as { action: { label: string; onClick: () => void } }).action
    expect(action.label).toBe('Undo')

    await act(async () => action.onClick())
    expect(set).toHaveBeenCalledWith(SHEET_DOCUMENT, { page: 1, region: kept.region, from: kept.from, to: kept.to, lengthM: 21, scope: 'page' })
    await waitFor(() => expect(hook.result.current.calibrations).toHaveLength(1))
  })

  it('keeps the list and says so when removing fails', async () => {
    const kept = calibrationView()
    const { client, withdraw } = recordingClient([kept])
    withdraw.mockRejectedValueOnce(new Error('offline'))
    const hook = mount(client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    await act(async () => {
      expect(await hook.result.current.withdraw(kept)).toBe(false)
    })
    expect(toast.error).toHaveBeenCalledWith('The scale could not be removed. Please try again.', expect.anything())
    expect(hook.result.current.calibrations).toEqual([kept])
  })

  it('keeps the draft when the popover closes, and drops it only on cancel or when the tool is put down', async () => {
    const hook = mount(recordingClient().client)
    await complete(hook)
    act(() => hook.result.current.setOpen(false))
    expect(hook.result.current).toMatchObject({ setting: true, open: true, step: 'review', lengthM: 21 })
    act(() => hook.result.current.cancel())
    expect(hook.result.current).toMatchObject({ setting: false, draft: null, lengthM: null })

    act(() => hook.result.current.beginSetting(1))
    act(() => hook.result.current.pick(1, FROM))
    hook.rerender({ tool: 'select' })
    expect(hook.result.current).toMatchObject({ setting: false, draft: null, open: false })
  })
})

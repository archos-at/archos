/**
 * The calibration's state in the review view: nothing where the feature is
 * off, one set call with shares of the page, a withdraw that returns the page
 * to its earlier state, and a draft that lives while the tool is in hand.
 */
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@/test-utils'
import { calibrationView, recordingClient, SHEET_DOCUMENT, SHEET_SIZE } from '@/test-utils/calibration-sheet'
import type { CalibrationClient } from '@/lib/drawing-calibrations/client'
import { DrawingMeasureAccess } from '../lib/drawing-measure-access'
import type { ReviewTool } from './use-document-review'
import { useReviewCalibration, type CalibrationHost } from './use-review-calibration'

const FROM = { x: 0.25, y: 0.5 }
const TO = { x: 0.75, y: 0.5 }
const BOX = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }

function mount(client: CalibrationClient, options: { flag?: boolean; load?: CalibrationHost['load'] } = {}) {
  const { flag = true, load = 'ready' } = options
  const setTool = vi.fn<(tool: ReviewTool) => void>()
  const hook = renderHook(
    ({ tool }: { tool: ReviewTool }) =>
      useReviewCalibration({ documentId: SHEET_DOCUMENT, load, tool, setTool, me: 'user_me', annotations: [] }, { client }),
    {
      initialProps: { tool: 'select' as ReviewTool },
      wrapper: ({ children }: { children: ReactNode }) => <DrawingMeasureAccess enabled={flag}>{children}</DrawingMeasureAccess>,
    }
  )
  return { ...hook, setTool }
}

/** The tool in hand, two points, a length and a region: everything a save needs. */
async function complete(hook: ReturnType<typeof mount>) {
  await waitFor(() => expect(hook.result.current.shown).toBe(true))
  hook.rerender({ tool: 'calibrate' })
  act(() => {
    hook.result.current.pick(1, FROM, SHEET_SIZE)
    hook.result.current.pick(1, TO, SHEET_SIZE)
    hook.result.current.setLength(21)
    hook.result.current.drawRegion(1, BOX)
  })
}

describe('useReviewCalibration', () => {
  it('shows nothing and asks nothing where the organization does not hold the feature', async () => {
    const { client, list } = recordingClient([calibrationView()])
    const hook = mount(client, { flag: false })
    await act(async () => {})
    expect(list).not.toHaveBeenCalled()
    expect(hook.result.current).toMatchObject({ shown: false, offered: false, open: false, calibrations: [] })
  })

  it('shows nothing when the list does not answer', async () => {
    const { client, list } = recordingClient()
    list.mockRejectedValueOnce(new Error('feature_disabled'))
    const hook = mount(client)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(hook.result.current.shown).toBe(false)
  })

  it('waits for the review to have read the document', async () => {
    const { client, list } = recordingClient()
    mount(client, { load: 'loading' })
    await act(async () => {})
    expect(list).not.toHaveBeenCalled()
  })

  it('lists the active calibrations and says whether the reader may calibrate', async () => {
    const saved = calibrationView()
    const hook = mount(recordingClient([saved], false).client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    expect(hook.result.current).toMatchObject({ canCalibrate: false, offered: false, calibrations: [saved] })
    expect(hook.result.current.onPage(1)).toEqual([saved])
    expect(hook.result.current.onPage(2)).toEqual([])
  })

  it('puts the tool down for a reader who may not calibrate', async () => {
    const hook = mount(recordingClient([], false).client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    hook.rerender({ tool: 'calibrate' })
    expect(hook.setTool).toHaveBeenCalledWith('select')
    expect(hook.result.current.active).toBe(false)
  })

  it('shows the ratio before saving, and saves once with shares of the page', async () => {
    const { client, set } = recordingClient()
    const hook = mount(client)
    await complete(hook)
    expect(hook.result.current.proposal).toMatchObject({ ratio: '1:100', blocked: null, regionSource: 'drawn' })
    expect(set).not.toHaveBeenCalled()

    // Two presses in one breath: one calibration.
    await act(async () => {
      const first = hook.result.current.save()
      const second = hook.result.current.save()
      await Promise.all([first, second])
    })

    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(SHEET_DOCUMENT, { page: 1, region: BOX, from: FROM, to: TO, lengthM: 21 })
    expect(hook.setTool).toHaveBeenCalledWith('select')
    expect(hook.result.current.calibrations).toHaveLength(1)
    expect(hook.result.current.calibrations[0]).toMatchObject({ region: BOX, lengthM: 21 })
  })

  it('does not save while the region is missing', async () => {
    const { client, set } = recordingClient()
    const hook = mount(client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    hook.rerender({ tool: 'calibrate' })
    act(() => {
      hook.result.current.pick(1, FROM, SHEET_SIZE)
      hook.result.current.pick(1, TO, SHEET_SIZE)
      hook.result.current.setLength(21)
    })
    await act(async () => {
      expect(await hook.result.current.save()).toBe(false)
    })
    expect(set).not.toHaveBeenCalled()
    expect(hook.result.current.proposal.blocked).toBe('region')
  })

  it('keeps the draft and says so when saving fails', async () => {
    const { client, set } = recordingClient()
    set.mockRejectedValueOnce(new Error('offline'))
    const hook = mount(client)
    await complete(hook)
    await act(async () => {
      expect(await hook.result.current.save()).toBe(false)
    })
    expect(hook.result.current.failure).toBe('save')
    expect(hook.result.current.draft).toMatchObject({ from: FROM, to: TO, lengthM: 21 })
    expect(hook.setTool).not.toHaveBeenCalledWith('select')
  })

  it('returns the page to its earlier state when a calibration is withdrawn', async () => {
    const kept = calibrationView()
    const { client, withdraw } = recordingClient([kept])
    const hook = mount(client)
    await complete(hook)
    await act(async () => {
      await hook.result.current.save()
    })
    const made = hook.result.current.calibrations.find((entry) => entry.id !== kept.id)
    expect(hook.result.current.calibrations).toHaveLength(2)

    await act(async () => {
      await hook.result.current.withdraw(made?.id ?? '')
    })

    expect(withdraw).toHaveBeenCalledWith(SHEET_DOCUMENT, made?.id)
    expect(hook.result.current.calibrations).toEqual([kept])
  })

  it('keeps the list and says so when withdrawing fails', async () => {
    const kept = calibrationView()
    const { client, withdraw } = recordingClient([kept])
    withdraw.mockRejectedValueOnce(new Error('offline'))
    const hook = mount(client)
    await waitFor(() => expect(hook.result.current.shown).toBe(true))
    await act(async () => {
      expect(await hook.result.current.withdraw(kept.id)).toBe(false)
    })
    expect(hook.result.current.failure).toBe('withdraw')
    expect(hook.result.current.calibrations).toEqual([kept])
  })

  it('lets the draft go when the tool is put down, and keeps the length when the points are set anew', async () => {
    const hook = mount(recordingClient().client)
    await complete(hook)
    act(() => hook.result.current.resetPoints())
    expect(hook.result.current.draft).toBeNull()
    expect(hook.result.current.lengthM).toBe(21)

    act(() => hook.result.current.pick(1, FROM, SHEET_SIZE))
    hook.rerender({ tool: 'select' })
    expect(hook.result.current.draft).toBeNull()
    hook.rerender({ tool: 'calibrate' })
    expect(hook.result.current.draft).toBeNull()
    expect(hook.result.current.lengthM).toBeNull()
  })
})

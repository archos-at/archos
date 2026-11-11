/**
 * A sheet to calibrate on, for the specs of the review view's calibrate tool:
 * the real hook, page layer and panel over a page element that states its size
 * in points the way the viewer does, with the three calls recorded.
 */
import { useMemo, useState, type JSX } from 'react'
import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { CalibrationPageLayer } from '@/features/documents/components/review/calibration-page-layer'
import { CalibrationPanel } from '@/features/documents/components/review/calibration-panel'
import type { ReviewTool } from '@/features/documents/hooks/use-document-review'
import { useReviewCalibration, type CalibrationHost } from '@/features/documents/hooks/use-review-calibration'
import type { StoredRegions } from '@/features/documents/lib/calibration-draft'
import { DrawingMeasureAccess } from '@/features/documents/lib/drawing-measure-access'
import type { CalibrationClient } from '@/lib/drawing-calibrations/client'
import type { CalibrationView, SetCalibrationRequest } from '@/lib/drawing-calibrations/wire'

export const SHEET_DOCUMENT = '11111111-1111-4111-8111-111111111111'
export const SHEET_VERSION = '22222222-2222-4222-8222-222222222222'

/** A page half of whose width is 210 mm of paper: 21 m across it is 1:100. */
export const SHEET_SIZE = { width: 1190.55, height: 841.89 }
/** The sheet as the specs measure it on screen, in CSS pixels. */
export const SHEET_BOX = { width: 1000, height: 700 }

export const calibrationView = (overrides: Partial<CalibrationView> = {}): CalibrationView => ({
  id: '33333333-3333-4333-8333-333333333333',
  documentId: SHEET_DOCUMENT,
  versionId: SHEET_VERSION,
  page: 1,
  region: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  from: { x: 0.25, y: 0.5 },
  to: { x: 0.75, y: 0.5 },
  lengthM: 21,
  status: 'active',
  createdBy: 'user_anna',
  createdAt: '2026-11-04T09:12:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
  ...overrides,
})

/** The three calls over one list, each recorded: what a set adds is listed, what a withdraw takes is gone. */
export function recordingClient(initial: readonly CalibrationView[] = [], canCalibrate = true) {
  let held = [...initial]
  let made = 0
  const list = vi.fn<CalibrationClient['list']>(async () => ({
    calibrations: [...held],
    nextCursor: null,
    versionId: SHEET_VERSION,
    canCalibrate,
  }))
  const set = vi.fn<CalibrationClient['set']>(async (_documentId: string, input: SetCalibrationRequest) => {
    made += 1
    const view = calibrationView({ ...input, id: `44444444-4444-4444-8444-44444444444${made}`, createdBy: 'user_me' })
    held = [...held, view]
    return view
  })
  const withdraw = vi.fn<CalibrationClient['withdraw']>(async (_documentId: string, calibrationId: string) => {
    const gone = held.find((entry) => entry.id === calibrationId) ?? calibrationView({ id: calibrationId })
    held = held.filter((entry) => entry.id !== calibrationId)
    return { ...gone, status: 'withdrawn', withdrawnAt: '2026-11-11T10:00:00.000Z', withdrawnBy: 'user_me' }
  })
  return { client: { list, set, withdraw } satisfies CalibrationClient, list, set, withdraw }
}

export function CalibrationSheet({
  client,
  flag = true,
  storedRegions,
  pageSize = SHEET_SIZE,
}: {
  client: CalibrationClient
  /** Whether the organization holds `drawing-measure`. */
  flag?: boolean
  storedRegions?: StoredRegions
  pageSize?: { width: number; height: number }
}): JSX.Element {
  const [tool, setTool] = useState<ReviewTool>('select')
  const host: CalibrationHost = useMemo(
    () => ({
      documentId: SHEET_DOCUMENT,
      load: 'ready',
      tool,
      setTool,
      me: 'user_me',
      annotations: [{ createdBy: 'user_anna', createdByName: 'Anna Berger' }],
    }),
    [tool]
  )
  return (
    <DrawingMeasureAccess enabled={flag}>
      <Sheet host={host} client={client} storedRegions={storedRegions} pageSize={pageSize} />
      <output data-testid="tool-in-hand">{tool}</output>
      <button type="button" onClick={() => setTool('select')}>
        put the tool down
      </button>
    </DrawingMeasureAccess>
  )
}

function Sheet({
  host,
  client,
  storedRegions,
  pageSize,
}: {
  host: CalibrationHost
  client: CalibrationClient
  storedRegions?: StoredRegions
  pageSize: { width: number; height: number }
}): JSX.Element {
  const calibration = useReviewCalibration(host, { client, storedRegions })
  return (
    <>
      <div data-page={1} data-page-width-pt={pageSize.width} data-page-height-pt={pageSize.height} data-testid="sheet">
        <CalibrationPageLayer page={1} calibration={calibration} />
      </div>
      <CalibrationPanel calibration={calibration} page={1} />
    </>
  )
}

/** The capture surface of the tool in hand, measured as the sheet's box. */
export function captureSurface(): HTMLElement {
  const capture = screen.getByTestId('calibration-capture')
  vi.spyOn(capture, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: SHEET_BOX.width, height: SHEET_BOX.height, right: SHEET_BOX.width, bottom: SHEET_BOX.height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
  capture.setPointerCapture = () => {}
  return capture
}

/** A click at a place of the sheet, given as shares of it. */
export function clickAt(x: number, y: number): void {
  const capture = captureSurface()
  const at = { clientX: x * SHEET_BOX.width, clientY: y * SHEET_BOX.height, pointerId: 1 }
  fireEvent.pointerDown(capture, { button: 0, ...at })
  fireEvent.pointerUp(capture, at)
}

/** A drag from one place of the sheet to another, as shares of it. */
export function dragBox(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const capture = captureSurface()
  const start = { clientX: from.x * SHEET_BOX.width, clientY: from.y * SHEET_BOX.height, pointerId: 1 }
  const end = { clientX: to.x * SHEET_BOX.width, clientY: to.y * SHEET_BOX.height, pointerId: 1 }
  fireEvent.pointerDown(capture, { button: 0, ...start })
  fireEvent.pointerMove(capture, end)
  fireEvent.pointerUp(capture, end)
}

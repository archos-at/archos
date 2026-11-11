'use client'

/**
 * Calibrating a drawing's scale in the review view (ADR-0183): the page's
 * active calibrations, the one being set with the `calibrate` tool in hand, and
 * the two writes, set and withdraw.
 *
 * Shown only where the organization holds `drawing-measure`
 * (`useDrawingMeasureEnabled`) AND the list answered: with the flag off, or a
 * list that failed, `shown` is false and the review is as it was before.
 *
 * The draft lives while the tool is in hand. Putting the tool down (Escape, V,
 * the tool's own button) lets it go; saving puts the tool down itself.
 *
 * `storedRegions` are the regions the file stores a scale for. No route serves
 * them to the browser yet (they are read by the agent's `sheet` operation
 * only), so the review passes none and every calibration's region is drawn.
 * The hook honours them once a route does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calibrationClient, type CalibrationClient } from '@/lib/drawing-calibrations/client'
import type { PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint, CalibrationRegion, CalibrationView } from '@/lib/drawing-calibrations/wire'
import {
  pickPoint,
  proposalOf,
  withDrawnRegion,
  withLength,
  type CalibrationDraft,
  type CalibrationProposal,
  type StoredRegions,
} from '../lib/calibration-draft'
import { useDrawingMeasureEnabled } from '../lib/drawing-measure-access'
import type { DocumentReview } from './use-document-review'

/** What of the review the calibration needs: the document, whether its marks are read, and the tool in hand. */
export type CalibrationHost = Pick<DocumentReview, 'documentId' | 'load' | 'tool' | 'setTool' | 'me'> & {
  annotations: ReadonlyArray<Pick<DocumentReview['annotations'][number], 'createdBy' | 'createdByName'>>
}

export interface ReviewCalibrationOptions {
  storedRegions?: StoredRegions
  /** The three calls, for a preview with fixed data or a spec. */
  client?: CalibrationClient
}

/** A write that failed, said beside the control that made it. */
export type CalibrationFailure = 'save' | 'withdraw'

const NO_REGIONS: StoredRegions = {}

export function useReviewCalibration(host: CalibrationHost, options: ReviewCalibrationOptions = {}) {
  const { documentId, tool, setTool, me, annotations } = host
  const { storedRegions = NO_REGIONS, client = calibrationClient } = options
  const flagOn = useDrawingMeasureEnabled()
  const reading = flagOn && host.load === 'ready'

  const [listed, setListed] = useState<{ documentId: string; calibrations: CalibrationView[]; canCalibrate: boolean } | null>(null)
  // The points and the box, and the length beside them: the length may be typed before the first click, and outlives points set anew.
  const [placed, setDraft] = useState<CalibrationDraft | null>(null)
  const [lengthM, setLength] = useState<number | null>(null)
  const draft = useMemo(() => (placed ? withLength(placed, lengthM) : null), [placed, lengthM])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<CalibrationFailure | null>(null)
  const [hoveredId, hover] = useState<string | null>(null)
  const [pageSizes, setPageSizes] = useState<Readonly<Record<number, PageSizePt>>>({})

  // Which read may still land: the latest one, for the document still shown.
  const reads = useRef({ documentId, ticket: 0 })
  reads.current.documentId = documentId
  const refresh = useCallback(async () => {
    const ticket = ++reads.current.ticket
    const result = await client.list(documentId)
    if (reads.current.documentId !== documentId || reads.current.ticket !== ticket) return
    setListed({ documentId, calibrations: result.calibrations, canCalibrate: result.canCalibrate && result.versionId !== null })
  }, [client, documentId])

  useEffect(() => {
    if (!reading) return
    // A list that does not answer (the feature off after all, the network) shows nothing new.
    refresh().catch(() => setListed(null))
  }, [reading, refresh])

  const current = reading && listed?.documentId === documentId ? listed : null
  const shown = current !== null
  const canCalibrate = current?.canCalibrate ?? false
  const offered = shown && canCalibrate
  const active = offered && tool === 'calibrate'

  // The draft belongs to the tool in hand and to one document.
  useEffect(() => {
    if (tool === 'calibrate') return
    setDraft(null)
    setLength(null)
    setFailure(null)
  }, [tool, documentId])
  // A reader who may not calibrate cannot hold the tool: a key or an old state never leaves it armed.
  useEffect(() => {
    if (tool === 'calibrate' && shown && !canCalibrate) setTool('select')
  }, [tool, shown, canCalibrate, setTool])

  const reportPageSize = useCallback((page: number, size: PageSizePt) => {
    setPageSizes((sizes) =>
      sizes[page]?.width === size.width && sizes[page]?.height === size.height ? sizes : { ...sizes, [page]: size }
    )
  }, [])

  const pick = useCallback(
    (page: number, point: CalibrationPoint, pageSize: PageSizePt) => setDraft((held) => pickPoint(held, page, point, pageSize)),
    []
  )
  const drawRegion = useCallback(
    (page: number, region: CalibrationRegion) => setDraft((held) => (held ? withDrawnRegion(held, page, region) : held)),
    []
  )
  /** Both points again, the length kept: a slipped click costs one step, not the form. */
  const resetPoints = useCallback(() => setDraft(null), [])

  const begin = useCallback(() => {
    setOpen(true)
    setTool('calibrate')
  }, [setTool])
  const cancel = useCallback(() => setTool('select'), [setTool])

  const proposal: CalibrationProposal = useMemo(() => proposalOf(draft, storedRegions), [draft, storedRegions])

  // A second press of Save, or Enter after it, must not set a second calibration.
  const inFlight = useRef(false)
  const save = useCallback(async (): Promise<boolean> => {
    const request = proposal.request
    if (!request || inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    setFailure(null)
    try {
      const made = await client.set(documentId, request)
      // The server's list is the truth (a calibration of the same region is superseded); until it answers, the new one is shown.
      setListed((held) =>
        held?.documentId === documentId
          ? { ...held, calibrations: [...held.calibrations.filter((entry) => entry.id !== made.id), made] }
          : held
      )
      setDraft(null)
      setLength(null)
      setTool('select')
      setOpen(true)
      refresh().catch(() => undefined)
      return true
    } catch {
      setFailure('save')
      return false
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [client, documentId, proposal.request, refresh, setTool])

  const withdraw = useCallback(
    async (calibrationId: string): Promise<boolean> => {
      setFailure(null)
      try {
        await client.withdraw(documentId, calibrationId)
        setListed((held) =>
          held?.documentId === documentId
            ? { ...held, calibrations: held.calibrations.filter((entry) => entry.id !== calibrationId) }
            : held
        )
        refresh().catch(() => undefined)
        return true
      } catch {
        setFailure('withdraw')
        return false
      }
    },
    [client, documentId, refresh]
  )

  /** Who set a calibration, where the review knows the name: from the marks' authors. The wire carries the id alone. */
  const nameOf = useCallback(
    (userId: string): string | null => annotations.find((annotation) => annotation.createdBy === userId)?.createdByName ?? null,
    [annotations]
  )

  const calibrations = current?.calibrations
  return useMemo(
    () => ({
      shown,
      canCalibrate,
      offered,
      active,
      /** The panel beside the page is open: always while the tool is in hand. */
      open: shown && (open || active),
      setOpen,
      calibrations: calibrations ?? [],
      onPage: (page: number) => (calibrations ?? []).filter((entry) => entry.page === page),
      draft: active ? draft : null,
      lengthM,
      proposal,
      storedRegions,
      pageSizes,
      reportPageSize,
      pick,
      drawRegion,
      setLength,
      resetPoints,
      begin,
      cancel,
      save,
      saving,
      withdraw,
      failure,
      hoveredId,
      hover,
      me,
      nameOf,
    }),
    [shown, canCalibrate, offered, active, open, calibrations, draft, lengthM, proposal, storedRegions, pageSizes, reportPageSize, pick, drawRegion, setLength, resetPoints, begin, cancel, save, saving, withdraw, failure, hoveredId, me, nameOf]
  )
}

export type ReviewCalibration = ReturnType<typeof useReviewCalibration>

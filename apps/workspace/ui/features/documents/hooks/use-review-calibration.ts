'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { calibrationClient, regionOverlap, type CalibrationClient } from '@/lib/drawing-calibrations/client'
import { calibrationRatio, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint, CalibrationRegion, CalibrationView } from '@/lib/drawing-calibrations/wire'
import { reviewToast } from '../components/review/review-toaster'
import {
  byAreaDescending,
  emptyDraft,
  pickPoint,
  proposalOf,
  requestOf,
  withRegion,
  type CalibrationDraft,
} from '../lib/calibration-draft'
import { DECISION_UNDO_MS, type DocumentReview, type ReviewTool } from './use-document-review'

export type CalibrationHost = Pick<DocumentReview, 'documentId' | 'load' | 'me'> & {
  tool: ReviewTool | 'measure'
  annotations: ReadonlyArray<Pick<DocumentReview['annotations'][number], 'createdBy' | 'createdByName'>>
}

export type SaveFailure = { kind: 'overlaps'; overlapping: string | null } | { kind: 'failed' }

type Listed = { documentId: string; calibrations: CalibrationView[]; canCalibrate: boolean }

const withEntry = (held: Listed | null, documentId: string, change: (list: CalibrationView[]) => CalibrationView[]) =>
  held?.documentId === documentId ? { ...held, calibrations: change(held.calibrations) } : held

export function useReviewCalibration(host: CalibrationHost, options: { client?: CalibrationClient } = {}) {
  const { documentId, tool, me, annotations } = host
  const client = options.client ?? calibrationClient
  const t = useTranslations(filesCopy)
  const measuring = tool === 'measure'

  const [wanted, setWanted] = useState<string | null>(null)
  const [listed, setListed] = useState<Listed | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<CalibrationDraft | null>(null)
  const [lengthM, setLength] = useState<number | null>(null)
  const [open, setOpenState] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null)
  const [hoveredId, hover] = useState<string | null>(null)
  const [pageSizes, setPageSizes] = useState<Readonly<Record<number, PageSizePt>>>({})
  const [said, setSaid] = useState('')

  useEffect(() => {
    if (measuring && host.load === 'ready') setWanted(documentId)
  }, [measuring, host.load, documentId])

  const reads = useRef({ documentId, ticket: 0 })
  reads.current.documentId = documentId
  const refresh = useCallback(async () => {
    const ticket = ++reads.current.ticket
    const result = await client.list(documentId)
    if (reads.current.documentId !== documentId || reads.current.ticket !== ticket) return
    setListed({ documentId, calibrations: result.calibrations, canCalibrate: result.canCalibrate && result.versionId !== null })
  }, [client, documentId])

  useEffect(() => {
    if (wanted !== documentId) return
    refresh().catch(() => setFailedFor(documentId))
  }, [wanted, documentId, refresh])

  const current = listed?.documentId === documentId ? listed : null
  const shown = current !== null
  const loading = wanted === documentId && !shown && failedFor !== documentId
  const canCalibrate = current?.canCalibrate ?? false
  const calibrations = useMemo(() => current?.calibrations ?? [], [current])
  const setting = measuring && canCalibrate && draft !== null

  useEffect(() => {
    if (measuring) return
    setDraft(null)
    setLength(null)
    setSaveFailure(null)
    setOpenState(false)
    hover(null)
  }, [measuring, documentId])

  const reportPageSize = useCallback((page: number, size: PageSizePt) => {
    setPageSizes((sizes) =>
      sizes[page]?.width === size.width && sizes[page]?.height === size.height ? sizes : { ...sizes, [page]: size }
    )
  }, [])

  const onPage = useCallback(
    (page: number) => calibrations.filter((entry) => entry.page === page).sort(byAreaDescending),
    [calibrations]
  )
  const ratioOf = useCallback(
    (entry: Pick<CalibrationView, 'page' | 'from' | 'to' | 'lengthM'>) => {
      const size = pageSizes[entry.page]
      return size ? calibrationRatio(entry, size) : null
    },
    [pageSizes]
  )
  const labelFor = useCallback(
    (page: number) => {
      const [first, ...others] = onPage(page)
      if (!first) return t('review.measure.scale.button.none')
      const ratio = ratioOf(first)
      if (!ratio) return t('review.measure.scale.button.count', { count: others.length + 1 })
      return others.length === 0
        ? t('review.measure.scale.button.one', { ratio })
        : t('review.measure.scale.button.more', { ratio, count: others.length })
    },
    [onPage, ratioOf, t]
  )

  const cancel = useCallback(() => {
    setDraft(null)
    setLength(null)
    setSaveFailure(null)
  }, [])
  const beginSetting = useCallback(
    (page: number) => {
      if (!canCalibrate) return
      setDraft(emptyDraft(page))
      setSaveFailure(null)
      setOpenState(true)
    },
    [canCalibrate]
  )
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      if (!next) {
        cancel()
        hover(null)
      }
    },
    [cancel]
  )
  const pick = useCallback((page: number, point: CalibrationPoint) => {
    setSaveFailure(null)
    setDraft((held) => (held ? pickPoint(held, page, point) : held))
  }, [])
  const drawRegion = useCallback((page: number, region: CalibrationRegion) => {
    setSaveFailure(null)
    setDraft((held) => (held ? withRegion(held, page, region) : held))
  }, [])
  const resetPoints = useCallback(() => setDraft((held) => (held ? emptyDraft(held.page) : held)), [])
  const changeLength = useCallback((value: number | null) => {
    setSaveFailure(null)
    setLength(value)
  }, [])

  const proposal = useMemo(
    () => proposalOf(draft, lengthM, draft ? (pageSizes[draft.page] ?? null) : null, calibrations),
    [draft, lengthM, pageSizes, calibrations]
  )

  const inFlight = useRef(false)
  const save = useCallback(async (): Promise<boolean> => {
    const request = proposal.request
    if (!request || inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    setSaveFailure(null)
    try {
      const made = await client.set(documentId, request)
      setListed((held) =>
        withEntry(held, documentId, (list) => [
          ...list.filter((entry) => entry.id !== made.id && entry.id !== proposal.replaces?.id),
          made,
        ])
      )
      const ratio = ratioOf(made)
      setSaid(ratio ? t('review.measure.scale.saved', { ratio }) : t('review.measure.scale.savedPlain'))
      setDraft(null)
      setLength(null)
      refresh().catch(() => undefined)
      return true
    } catch (error) {
      const overlap = regionOverlap(error)
      setSaveFailure(overlap ? { kind: 'overlaps', overlapping: overlap.overlapping } : { kind: 'failed' })
      if (overlap) refresh().catch(() => undefined)
      return false
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [client, documentId, proposal, ratioOf, refresh, t])

  const restore = useCallback(
    async (entry: CalibrationView) => {
      try {
        const made = await client.set(entry.documentId, requestOf(entry))
        setListed((held) => withEntry(held, entry.documentId, (list) => [...list.filter((one) => one.id !== made.id), made]))
        refresh().catch(() => undefined)
      } catch {
        toast.error(t('review.measure.scale.restoreFailed'), reviewToast())
      }
    },
    [client, refresh, t]
  )

  const withdraw = useCallback(
    async (entry: CalibrationView): Promise<boolean> => {
      const ratio = ratioOf(entry)
      try {
        await client.withdraw(documentId, entry.id)
      } catch {
        toast.error(t('review.measure.scale.removeFailed'), reviewToast())
        return false
      }
      setListed((held) => withEntry(held, documentId, (list) => list.filter((one) => one.id !== entry.id)))
      hover((held) => (held === entry.id ? null : held))
      refresh().catch(() => undefined)
      toast(
        ratio ? t('review.measure.scale.removed', { ratio }) : t('review.measure.scale.removedPlain'),
        reviewToast({
          id: `calibration-removed-${entry.id}`,
          duration: DECISION_UNDO_MS,
          action: { label: t('review.undo'), onClick: () => void restore(entry) },
        })
      )
      return true
    },
    [client, documentId, ratioOf, refresh, restore, t]
  )

  const nameOf = useCallback(
    (userId: string): string | null =>
      annotations.find((annotation) => annotation.createdBy === userId)?.createdByName ?? null,
    [annotations]
  )

  return useMemo(
    () => ({
      shown,
      loading,
      canCalibrate,
      calibrations,
      onPage,
      ratioOf,
      labelFor,
      open: shown && open,
      setOpen,
      setting,
      draft: setting ? draft : null,
      lengthM,
      setLength: changeLength,
      proposal,
      beginSetting,
      cancel,
      pick,
      drawRegion,
      resetPoints,
      save,
      saving,
      saveFailure,
      withdraw,
      restore,
      hoveredId,
      hover,
      pageSizes,
      reportPageSize,
      me,
      nameOf,
      said,
    }),
    [shown, loading, canCalibrate, calibrations, onPage, ratioOf, labelFor, open, setOpen, setting, draft, lengthM, changeLength, proposal, beginSetting, cancel, pick, drawRegion, resetPoints, save, saving, saveFailure, withdraw, restore, hoveredId, pageSizes, reportPageSize, me, nameOf, said]
  )
}

export type ReviewCalibration = ReturnType<typeof useReviewCalibration>

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Boxes } from 'lucide-react'

import { useIsMobile } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'

import { documentDisplayName } from '@/lib/documents/display-name'

import { storeyKey, supportsWebGpu, type BimViewerElement } from '../lib/model-index'
import { buildModelQuery, parseModelView, withModelView, type BimModelView } from '../lib/model-link'
import { formatLevelElevation, levelElevation, pickStageModel, stageLevels, stageModelLabel, stageModelMatched } from '../lib/stage-model'

import { useAdvancedSheet } from '../hooks/use-advanced-sheet'
import { useBimElementDetail, useBimElements, useBimModelSource, useDocumentBimModel, useProjectBimModels } from '../hooks/use-bim-model'
import { useCopyLink } from '../hooks/use-copy-link'
import { useModelViewport } from '../hooks/use-model-viewport'
import { useStageCapture } from '../hooks/use-stage-capture'
import { useStageHistory } from '../hooks/use-stage-history'
import { useStageLayout } from '../hooks/use-stage-layout'

import { ModelInspector } from './model-inspector'

import { PhoneMoreRows, type PhoneSheet } from './stage-phone-chrome'

import { ViewerRailItem, ViewerRailSection, ViewerSheet, type ViewerSheetSnap } from './viewer'
import { NO_ELEMENTS, visibilityActions } from './model-stage-helpers'

export interface ModelStageProps {
  projectId: string | null
  documentId?: string
  onClose: () => void
  onModelRenamed?: (documentId: string, displayName: string | null) => void
  onModelDeleted?: (documentId: string) => void
  canCollaborate?: boolean
}

export function useModelStageController(props: ModelStageProps) {
  const {
  projectId,
  documentId,
  onClose,
  onModelRenamed,
  onModelDeleted,
  canCollaborate = false,
  } = props
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const view = useMemo<BimModelView>(
    () => parseModelView(searchParams?.toString() ?? ''),
    [searchParams]
  )

  const navigate = useCallback(
    (next: BimModelView) => {
      router.replace(`${pathname}${buildModelQuery(next)}`, { scroll: false })
    },
    [pathname, router]
  )

  const { history, setHistory, collecting, pushStep, asOneStep } = useStageHistory()

  const setView = useCallback(
    (patch: Partial<BimModelView>) => {
      const next = withModelView(view, patch)
      if (buildModelQuery(next) === buildModelQuery(view)) return
      pushStep({ view, visibility: null })
      navigate(next)
    },
    [navigate, pushStep, view]
  )

  const projectModels = useProjectBimModels(projectId)
  const officeShelfModel = useDocumentBimModel(projectId ? null : (documentId ?? null))
  const {
    data: models,
    isLoading,
    error,
    reload: reloadModels,
  } = useMemo(() => {
    if (projectId) return projectModels
    return {
      data: officeShelfModel.data === null ? (officeShelfModel.isLoading ? null : []) : [officeShelfModel.data],
      isLoading: officeShelfModel.isLoading,
      error: officeShelfModel.error,
      reload: officeShelfModel.reload,
    }
  }, [projectId, projectModels, officeShelfModel])
  const model = useMemo(() => pickStageModel(models ?? [], view.model), [models, view.model])
  const openedAnother = models !== null && !stageModelMatched(model, view.model)
  const modelId = model?.status === 'ready' ? model.id : null

  useEffect(() => {
    setHistory((stack) =>
      stack.some((step) => step.visibility)
        ? stack.map((step) => ({ view: step.view, visibility: null })).filter((step) => step.view)
        : stack
    )
  }, [modelId])

  const storey = view.storey ?? null
  const selectedGlobalId = view.element ?? null

  const {
    data: elements,
    isLoading: elementsLoading,
    error: elementsError,
    reload: reloadElements,
  } = useBimElements(modelId)
  const elementList = elements ?? NO_ELEMENTS
  const detail = useBimElementDetail(modelId, selectedGlobalId)
  const source = useBimModelSource(modelId, supportsWebGpu())

  const levels = useMemo(() => stageLevels(model?.summary), [model?.summary])

  const { captureFailed, setCaptureFailed, handleCapture, modelFilenameRef } = useStageCapture(model?.filename ?? null)

  const stageRef = useRef<HTMLDivElement>(null)
  const focusViewport = useCallback(() => {
    const root = stageRef.current
    if (!root) return
    const canvas = root.querySelector('canvas')
    if (canvas) canvas.focus()
    else root.focus()
  }, [])

  const highlights = useMemo(
    () =>
      (view.highlights ?? []).map((group) => ({
        globalIds: group.globalIds,
        label:
          group.label ??
          t(
            `health.severity.${group.status === 'fail' ? 'error' : group.status === 'warning' ? 'warning' : 'info'}`
          ),
        status: group.status,
      })),
    [view.highlights, t]
  )

  const handleSelect = useCallback(
    (element: BimViewerElement | null) => {
      if (!element) {
        setView({ element: undefined })
        return
      }
      const elementStorey = element.storeyName ?? null
      setView({
        element: element.globalId,
        ...(elementStorey !== null && elementStorey !== storey ? { storey: elementStorey } : {}),
      })
    },
    [setView, storey]
  )

  const viewport = useModelViewport({
    sourceUrl: source.data,
    elements: elementList,
    highlights,
    isolatedStorey: storey,
    selectedGlobalId,
    onSelect: handleSelect,
    xray: view.xray ?? false,
    camera: view.camera,
    onCameraChange: (camera) => setView({ camera }),
    compact: false,
    onCapture: handleCapture,
    onVisibilityEdit: (previous) => pushStep({ view: null, visibility: previous }),
  })

  const goBack = useCallback(() => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((stack) => stack.slice(0, -1))
    if (previous.visibility) viewport.visibility.restore(previous.visibility)
    if (previous.view) navigate(previous.view)
  }, [history, navigate, viewport.visibility])

  const isMobile = useIsMobile()
  const [railChoice, setRailChoice] = useState<boolean | null>(null)
  const layout = useStageLayout()
  const compact = layout !== 'desktop'
  const coarsePointer = useMediaQuery('(pointer: coarse)')
  const railOpen = !compact && (railChoice ?? !isMobile)
  const [phoneSheet, setPhoneSheet] = useState<PhoneSheet | null>(null)
  const [selectionSnap, setSelectionSnap] = useState<ViewerSheetSnap>('peek')
  const togglePhoneSheet = useCallback(
    (sheet: PhoneSheet) => setPhoneSheet((current) => (current === sheet ? null : sheet)),
    []
  )
  const linkedOpen = view.tab !== undefined && modelId !== null
  const {
    advancedOpen,
    setAdvancedOpenEcho,
    setAdvancedOpen,
    advancedToggleRef,
    restoreAdvancedFocus,
    closeAdvanced,
  } = useAdvancedSheet({ linkedOpen, view, setView, focusViewport })

  const { copied, setCopied, copyFailed, setCopyFailed, copyLink } = useCopyLink()

  const measureLabels = useMemo(
    () => ({
      horizontal: t('viewer.measure.horizontal'),
      vertical: t('viewer.measure.vertical'),
      locale,
    }),
    [t, locale]
  )

  const railHasContent = (models ?? []).length > 1 || levels.length > 0

  const unresolvedHighlights =
    elementsLoading || elementsError !== null
      ? 0
      : viewport.highlights.reduce((sum, group) => sum + group.unresolved.length, 0)

  const cappedHighlights = (view.highlights ?? []).reduce(
    (sum, group) => sum + Math.max(0, (group.total ?? 0) - group.globalIds.length),
    0
  )

  const stageWarning = useMemo((): { text: string; retry: boolean } | null => {
    if (captureFailed) return { text: t('viewer.capture.failed'), retry: false }
    if (copyFailed) return { text: t('link.failed'), retry: false }
    if (elementsError !== null) return { text: t('stage.elementsFailed'), retry: true }
    if (openedAnother) {
      return {
        text: t('stage.otherModel', { wanted: view.model ?? '', opened: model?.filename ?? '' }),
        retry: false,
      }
    }
    if (unresolvedHighlights > 0) {
      return {
        text:
          unresolvedHighlights === 1
            ? t('card.unresolvedOne')
            : t('card.unresolved', { count: unresolvedHighlights }),
        retry: false,
      }
    }
    if (cappedHighlights > 0) {
      const groups = view.highlights ?? []
      return {
        text: t('stage.highlightCapped', {
          shown: groups.reduce((sum, group) => sum + group.globalIds.length, 0),
          total: groups.reduce((sum, group) => sum + (group.total ?? group.globalIds.length), 0),
        }),
        retry: false,
      }
    }
    return null
  }, [
    captureFailed,
    copyFailed,
    elementsError,
    openedAnother,
    unresolvedHighlights,
    cappedHighlights,
    view.model,
    view.highlights,
    model?.filename,
    t,
  ])

  const newestMeasurement = viewport.measure.measurements.at(-1)

  const stageAnnouncement = useMemo(() => {
    if (error) return t('loadFailed.title')
    if (source.error) return t('viewer.unavailable.title')
    if (viewport.status.phase === 'error') return t('viewer.unavailable.title')
    if (captureFailed) return t('viewer.capture.failed')
    if (copyFailed) return t('link.failed')
    if (copied) return t('link.copied')
    if (viewport.status.phase === 'parsing') return t('stage.building')
    if (viewport.status.phase === 'downloading') return t('stage.loading')
    if (stageWarning) return stageWarning.text
    if (viewport.status.phase === 'ready') return t('stage.ready')
    return ''
  }, [
    error,
    source.error,
    viewport.status.phase,
    captureFailed,
    copyFailed,
    copied,
    stageWarning,
    t,
  ])

  const xrayNeedsTarget =
    viewport.highlights.length === 0 && viewport.selectedExpressId === null

  const section = viewport.section
  const cutDefault = viewport.defaultCut(levelElevation(model?.summary, storey))

  const dockAboveRows = ((viewport.measure.active || viewport.measure.measurements.length > 0
    ? 1
    : 0) + (section && viewport.bounds ? 1 : 0)) as 0 | 1 | 2

  const railSections = (
    <>
      {/*
        A list of one is not a list. Most projects carry a single
        model, and a "Modelle" heading over one row is a section that
        exists to be looked past — the rail is half as tall without
        it, and the reader loses nothing, because the model's name is
        already the dialog's title.
      */}
      {(models ?? []).length > 1 && (
      <ViewerRailSection label={t('stage.models')}>
        {(models ?? []).map((candidate) => (
          <ViewerRailItem
            key={candidate.id}
            label={stageModelLabel(documentDisplayName(candidate))}
            icon={<Boxes aria-hidden="true" />}
            meta={candidate.status === 'ready' ? undefined : t(`status.${candidate.status}`)}
            selected={candidate.id === model?.id}
            disabled={candidate.status !== 'ready'}
            onClick={() => {
              setPhoneSheet(null)
              setView({
                model: candidate.filename,
                storey: undefined,
                element: undefined,
                highlights: undefined,
                xray: undefined,
              })
            }}
          />
        ))}
      </ViewerRailSection>
      )}

      {levels.length > 0 && (
        <ViewerRailSection label={t('stage.levels')}>
          <ViewerRailItem
            label={t('stage.allLevels')}
            selected={storey === null}
            onClick={() => {
              setPhoneSheet(null)
              setView({ storey: undefined })
            }}
          />
          {levels.map((level) => (
            <ViewerRailItem
              key={level.name}
              label={level.name}
              meta={
                level.elevation === null
                  ? undefined
                  : t('stage.elevation', { value: formatLevelElevation(level.elevation, locale) })
              }
              ariaLabel={level.name}
              selected={storeyKey(storey) === storeyKey(level.name)}
              onClick={() => {
                setPhoneSheet(null)
                setView({
                  storey:
                    storeyKey(storey) === storeyKey(level.name) ? undefined : level.name,
                })
              }}
            />
          ))}
        </ViewerRailSection>
      )}
    </>
  )

  const legendEntries =
    elementsLoading || elementsError !== null
      ? []
      : viewport.highlights.map((highlight) => ({
          status: highlight.status,
          label: highlight.label,
          count: highlight.expressIds.length,
        }))

  const renderInspector = (placement?: 'bottom' | 'side'): JSX.Element => (
    <ModelInspector
      element={detail.data}
      isLoading={detail.isLoading}
      error={detail.error}
      projectId={projectId}
      modelFilename={model?.filename ?? null}
      sheet={
        placement
          ? {
              placement,
              collapse: {
                snap: selectionSnap,
                onSnapChange: setSelectionSnap,
                expandLabel: t('stage.sheet.expand'),
                collapseLabel: t('stage.sheet.collapse'),
              },
            }
          : undefined
      }
      onClose={() => {
        setView({ element: undefined })
        focusViewport()
      }}
      {...visibilityActions(viewport, () => setView({ element: undefined }), focusViewport, asOneStep)}
    />
  )

  const sheetPlacement = layout === 'phone-landscape' ? 'side' : 'bottom'
  const compactSheet: JSX.Element | null = !compact || advancedOpen
    ? null
    : phoneSheet === 'levels'
      ? (
          <ViewerSheet
            placement={sheetPlacement}
            title={levels.length > 0 ? t('stage.levels') : t('stage.models')}
            closeLabel={t('stage.selection.close')}
            onClose={() => setPhoneSheet(null)}
            bodyClassName="p-0"
          >
            {railSections}
          </ViewerSheet>
        )
      : phoneSheet === 'more'
        ? (
            <ViewerSheet
              placement={sheetPlacement}
              title={t('stage.more')}
              closeLabel={t('stage.selection.close')}
              onClose={() => setPhoneSheet(null)}
              bodyClassName="p-0"
            >
              <PhoneMoreRows
                ready={viewport.status.phase === 'ready'}
                canUndo={history.length > 0}
                onUndo={() => {
                  goBack()
                  setPhoneSheet(null)
                }}
                onCapture={() => {
                  viewport.capture()
                  setPhoneSheet(null)
                }}
                captureFailed={captureFailed}
                xray={view.xray ?? false}
                xrayHint={t('viewer.xrayHint')}
                xrayDisabled={xrayNeedsTarget}
                onToggleXray={() => setView({ xray: !(view.xray ?? false) })}
                edited={viewport.visibility.edited}
                onShowEverything={() => {
                  viewport.visibility.showEverything()
                  setPhoneSheet(null)
                  focusViewport()
                }}
                advancedDisabled={!modelId}
                onOpenAdvanced={() => {
                  setPhoneSheet(null)
                  setAdvancedOpen(true)
                }}
              />
            </ViewerSheet>
          )
        : selectedGlobalId
          ? renderInspector(sheetPlacement)
          : null

  return {
    advancedOpen,
    advancedToggleRef,
    asOneStep,
    canCollaborate,
    cappedHighlights,
    captureFailed,
    closeAdvanced,
    coarsePointer,
    collecting,
    compact,
    compactSheet,
    copied,
    copyFailed,
    copyLink,
    cutDefault,
    detail,
    dockAboveRows,
    documentId,
    elementList,
    elements,
    elementsError,
    elementsLoading,
    error,
    focusViewport,
    goBack,
    handleCapture,
    handleSelect,
    highlights,
    history,
    isLoading,
    isMobile,
    layout,
    legendEntries,
    levels,
    linkedOpen,
    locale,
    measureLabels,
    model,
    modelFilenameRef,
    modelId,
    models,
    navigate,
    newestMeasurement,
    officeShelfModel,
    onClose,
    onModelDeleted,
    onModelRenamed,
    openedAnother,
    pathname,
    phoneSheet,
    projectId,
    projectModels,
    pushStep,
    railChoice,
    railHasContent,
    railOpen,
    railSections,
    reloadElements,
    reloadModels,
    renderInspector,
    restoreAdvancedFocus,
    router,
    searchParams,
    section,
    selectedGlobalId,
    selectionSnap,
    setAdvancedOpen,
    setAdvancedOpenEcho,
    setCaptureFailed,
    setCopied,
    setCopyFailed,
    setHistory,
    setPhoneSheet,
    setRailChoice,
    setSelectionSnap,
    setView,
    sheetPlacement,
    source,
    stageAnnouncement,
    stageRef,
    stageWarning,
    storey,
    t,
    togglePhoneSheet,
    unresolvedHighlights,
    view,
    viewport,
    xrayNeedsTarget,
  }
}

export type ModelStageController = ReturnType<typeof useModelStageController>

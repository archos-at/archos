'use client'

import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { cn } from '@/lib/utils'
import type { BimViewerElement } from '../lib/model-index'
import type { BimModelTab } from '../lib/model-link'
import { findRevisionSeries, groupModelRevisions } from '../lib/revisions'
import {
  useBimCompliance,
  useBimComplianceDiff,
  useBimProfileSuggestions,
  useBimRoomSchedule,
  useBimTakeoff,
  useProjectRuleFacts,
  type BimModelHeaderView,
} from '../hooks/use-bim-model'
import { ViewerSurface } from './viewer'
import {
  IfcElementTable,
  IfcModelHealthPanel,
  IfcModelOverview,
  IfcSpatialTree,
} from './ifc-model-explorer'
import { IfcCompliancePanel } from './ifc-compliance-panel'
import { IfcComplianceDiff } from './ifc-compliance-diff'
import { IfcModelCompare } from './ifc-model-compare'
import { IfcProfileSuggestions, IfcQuantityTakeoff, IfcRoomSchedule } from './ifc-model-tables'
import { IfcRevisionTimeline } from './ifc-revision-timeline'

let compareRequests = 0
const compareToken = (): number => (compareRequests += 1)

export interface ModelAdvancedSheetProps {
  open: boolean
  onClose: () => void
  projectId: string | null
  model: BimModelHeaderView
  models: readonly BimModelHeaderView[]
  elements: readonly BimViewerElement[]
  elementsLoading?: boolean
  elementsError?: boolean
  onReloadElements?: () => void
  tab: BimModelTab
  onTabChange: (tab: BimModelTab) => void
  storey: string | null
  onSelectStorey: (storey: string | null) => void
  selectedGlobalId: string | null
  onSelectElement: (element: BimViewerElement | null) => void
  onShowElements: (globalIds: string[], status?: 'fail' | 'info') => void
  onOpenModel: (filename: string) => void
}

export function ModelAdvancedSheet({
  open,
  onClose,
  projectId,
  model,
  models,
  elements,
  elementsLoading = false,
  elementsError = false,
  onReloadElements,
  tab,
  onTabChange,
  storey,
  onSelectStorey,
  selectedGlobalId,
  onSelectElement,
  onShowElements,
  onOpenModel,
}: ModelAdvancedSheetProps): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const modelId = model.status === 'ready' ? model.id : null

  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (open) headingRef.current?.focus()
  }, [open])

  const [takeoffQuantity, setTakeoffQuantity] = useState<string>('NetSideArea')
  const [takeoffByMaterial, setTakeoffByMaterial] = useState(false)
  const [visited, setVisited] = useState<ReadonlySet<BimModelTab>>(() => new Set())
  useEffect(() => {
    if (!open) return
    setVisited((seen) => (seen.has(tab) ? seen : new Set(seen).add(tab)))
  }, [open, tab])
  const opened = (candidate: BimModelTab): boolean => open && visited.has(candidate)

  const quantitiesOpen = opened('quantities')
  const schedule = useBimRoomSchedule(quantitiesOpen ? modelId : null)
  const takeoff = useBimTakeoff(
    quantitiesOpen ? modelId : null,
    takeoffQuantity,
    takeoffByMaterial
  )
  const profile = useBimProfileSuggestions(opened('overview') ? modelId : null)

  const ruleFacts = useProjectRuleFacts(projectId)

  const series = useMemo(
    () => findRevisionSeries(groupModelRevisions([...models]), model.id),
    [models, model.id]
  )

  const seriesModelIds = useMemo(
    () => (series ?? { revisions: [] }).revisions.map((entry) => entry.model.id),
    [series]
  )

  const compliance = useBimCompliance(
    projectId,
    projectId && opened('compliance') ? modelId : null,
    ruleFacts,
    seriesModelIds
  )

  const previousRevision = useMemo(() => {
    if (!series) return null
    const index = series.revisions.findIndex((entry) => entry.model.id === model.id)
    return index > 0 ? series.revisions[index - 1].model : null
  }, [series, model.id])
  const complianceDiff = useBimComplianceDiff(modelId, previousRevision?.id ?? null, ruleFacts)

  const [compareRequest, setCompareRequest] = useState<{ baseModelId: string; at: number } | null>(
    null
  )

  const bcfHref = useMemo(() => {
    if (!modelId || !projectId) return null
    const query = new URLSearchParams({ modelId })
    if (ruleFacts.buildingClass !== null) {
      query.set('buildingClass', String(ruleFacts.buildingClass))
    }
    if (ruleFacts.mainUse !== null) query.set('mainUse', ruleFacts.mainUse)
    return `/api/projects/${projectId}/bim/checks/export?${query.toString()}`
  }, [modelId, projectId, ruleFacts.buildingClass, ruleFacts.mainUse])

  const profileQuestionHref = useMemo(() => {
    if (!projectId) return null
    const question = `Übernimm die aus dem Modell ${model.filename} ableitbaren Projektangaben in die Projektdaten.`
    return `/app/projects/${projectId}/chat?${new URLSearchParams({ ask: question }).toString()}`
  }, [model.filename, projectId])

  if (!open) return null

  return (
    <ViewerSurface
      role="complementary"
      aria-label={t('stage.advanced')}
      className={cn(
        'absolute top-16 right-3 bottom-3 z-30 flex w-[min(26rem,calc(100%-1.5rem))] flex-col overflow-hidden sm:top-[4.5rem] sm:right-4 sm:bottom-4',
        'animate-in fade-in-0 slide-in-from-right-2 duration-base ease-entrance motion-reduce:animate-none'
      )}
    >
      <div className="border-border flex items-center justify-between gap-2 border-b p-3">
        {/*
          Focused when the drawer opens, so a keyboard or screen-reader user
          is told a panel appeared and starts inside it. Without this the
          reader pressed "Erweitert" and stayed on a dock button while four
          tabs of Prüfbuch, Raumbuch, Mengen and Revisionen mounted silently
          behind them — the panel existed and was, for them, unreachable
          except by Tabbing past the whole viewer chrome.

          `tabIndex={-1}`: programmatically focusable, not a Tab stop.
        */}
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-medium focus-visible:outline-none">
          {t('stage.advanced')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 size-7 rounded-lg"
          onClick={onClose}
          aria-label={t('stage.selection.close')}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {/*
        `forceMount` with a `hidden` inactive state, rather than Radix's
        default unmount.

        An inactive tab used to be destroyed, and every panel here holds state
        worth more than the render it costs: the comparison result — which read
        two full element sets at `limit: 20_000` — the element table's search
        text and type filter, the Raumbuch's expansion, and every panel's
        scroll offset. Leaving Revisionen and coming back silently discarded
        all of it and reset the base model to the first candidate.

        It also refired the gated queries. The comment on those says they are
        "fetched only once its tab is open"; with an unmounting tab, "once"
        meant once per visit.
      */}
      <Tabs
        value={tab}
        onValueChange={(next) => onTabChange(next as BimModelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-3 mt-2 shrink-0 justify-start overflow-x-auto">
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          {/* Disabled rather than removed: the tab going missing in the Archiv
              would read as the Prüfbuch having been lost, and the reader would
              go looking for it. Present and explained is the honest shape. */}
          <TabsTrigger
            value="compliance"
            disabled={projectId === null}
            title={projectId === null ? t('tabs.complianceNeedsProject') : undefined}
          >
            {t('tabs.compliance')}
          </TabsTrigger>
          <TabsTrigger value="structure">{t('tabs.structure')}</TabsTrigger>
          <TabsTrigger value="quantities">{t('tabs.quantities')}</TabsTrigger>
          <TabsTrigger value="revisions">{t('tabs.revisions')}</TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          forceMount
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          {model.summary && <IfcModelOverview summary={model.summary} filename={model.filename} />}
          {model.summary?.health && (
            <IfcModelHealthPanel health={model.summary.health} onShowElements={onShowElements} />
          )}
          <IfcProfileSuggestions
            onRetry={profile.reload}
            suggestions={profile.data}
            isLoading={profile.isLoading}
            error={profile.error}
            askHref={profileQuestionHref}
          />
        </TabsContent>

        <TabsContent
          value="compliance"
          forceMount
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          {/* `forceMount` above keeps every tab mounted, so this cannot lean on
              the trigger being disabled — the panel would still run, with no
              Gebäudeklasse and no Hauptnutzung, and render as a catalogue that
              found nothing. The sentence is the honest answer instead. */}
          {projectId === null ? (
            <EmptyState
              variant="bare"
              icon={ClipboardCheck}
              title={t('tabs.complianceNeedsProject')}
              description={t('tabs.complianceNeedsProjectDescription')}
            />
          ) : (
          <IfcCompliancePanel
            onRetry={compliance.reload}
            onShowElements={onShowElements}
            factsFailed={ruleFacts.failed}
            onRetryFacts={ruleFacts.reload}
            rules={compliance.data?.rules ?? null}
            summary={compliance.data?.summary ?? null}
            shoppingList={compliance.data?.shoppingList ?? null}
            isLoading={compliance.isLoading || !ruleFacts.ready}
            error={compliance.error}
            truncated={compliance.data?.truncated ?? false}
            projectId={projectId}
            modelFilename={model.filename}
            missingFacts={ruleFacts.missing}
            askHref={profileQuestionHref}
            onConfirm={compliance.confirm}
            onWithdraw={compliance.withdraw}
            bcfHref={bcfHref}
          />
          )}
        </TabsContent>

        <TabsContent
          value="structure"
          forceMount
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          {model.summary && (
            <IfcSpatialTree
              summary={model.summary}
              selectedStorey={storey}
              onSelectStorey={onSelectStorey}
            />
          )}
          <IfcElementTable
            elements={elements}
            isLoading={elementsLoading}
            error={elementsError}
            onRetry={onReloadElements}
            truncatedAt={model.summary?.truncatedAt ?? null}
            storeyFilter={storey}
            selectedGlobalId={selectedGlobalId}
            onSelect={onSelectElement}
          />
        </TabsContent>

        <TabsContent
          value="quantities"
          forceMount
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          <IfcRoomSchedule
            onRetry={schedule.reload}
            schedule={schedule.data?.schedule ?? null}
            truncated={schedule.data?.truncated ?? false}
            isLoading={schedule.isLoading}
            error={schedule.error}
            filename={model.filename}
            selectedGlobalId={selectedGlobalId}
            onSelect={(globalId) =>
              onSelectElement(elements.find((e) => e.globalId === globalId) ?? null)
            }
          />
          <IfcQuantityTakeoff
            units={
              schedule.data?.schedule.units ?? { area: '', volume: '', length: '' }
            }
            onRetry={takeoff.reload}
            rows={takeoff.data?.rows ?? null}
            truncated={takeoff.data?.truncated ?? false}
            isLoading={takeoff.isLoading}
            error={takeoff.error}
            quantity={takeoffQuantity}
            onQuantityChange={setTakeoffQuantity}
            byMaterial={takeoffByMaterial}
            onByMaterialChange={setTakeoffByMaterial}
          />
        </TabsContent>

        <TabsContent
          value="revisions"
          forceMount
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          <IfcRevisionTimeline
            series={series}
            currentModelId={model.id}
            onOpen={(next) => onOpenModel(next.filename)}
            onCompareWithPrevious={(revision, previous) => {
              onOpenModel(revision.model.filename)
              setCompareRequest({ baseModelId: previous.id, at: compareToken() })
            }}
          />
          <IfcComplianceDiff
            baseModel={previousRevision}
            changes={complianceDiff.data?.changes ?? null}
            truncated={complianceDiff.data?.truncated ?? false}
            isLoading={complianceDiff.isLoading}
            error={complianceDiff.error}
            onRun={complianceDiff.run}
          />
          <IfcModelCompare
            modelId={model.id}
            candidates={models.filter(
              (candidate) => candidate.id !== model.id && candidate.status === 'ready'
            )}
            requested={compareRequest}
          />
        </TabsContent>
      </Tabs>
    </ViewerSurface>
  )
}

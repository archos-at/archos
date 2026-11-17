'use client'

import { type FC, useCallback, useMemo } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription } from '@/components/ui/field'
import { ItemList } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAuth } from '@/adapters/auth'
import { useChatStore } from '@/features/chat/store'
import { useIsCurrentSessionBusy } from '@/features/chat'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'
import { SectionLabel } from '@/components/ui/section-label'
import { useLayoutStore } from '../../store'
import { computePresetSourceIds } from '../../lib/source-presets'
import type { SourcePresetId } from '../../types'
import { iconForTint } from '../SourceSignalChip'
import { SourceBasisRow } from './SourceBasisRow'
import { buildSourceBasis, hasNoExternalSources, summariseBasis } from './source-basis-model'

const PRESETS: readonly SourcePresetId[] = ['law', 'office', 'project']
const ALL = 'all'

export const SourceBasisPicker: FC = () => {
  const t = useTranslations(researchCopy)
  const tc = useTranslations(commonCopy)
  const { idToken } = useAuth()

  const enabledDataSourceIds = useLayoutStore((s) => s.enabledDataSourceIds)
  const availableDataSources = useLayoutStore((s) => s.availableDataSources)
  const knowledgeLayerAvailable = useLayoutStore((s) => s.knowledgeLayerAvailable)
  const activeSourcePreset = useLayoutStore((s) => s.activeSourcePreset)
  const dataSourcesLoading = useLayoutStore((s) => s.dataSourcesLoading)
  const dataSourcesError = useLayoutStore((s) => s.dataSourcesError)
  const toggleDataSource = useLayoutStore((s) => s.toggleDataSource)
  const applySourcePreset = useLayoutStore((s) => s.applySourcePreset)
  const fetchDataSources = useLayoutStore((s) => s.fetchDataSources)
  const saveDataSourcesToConversation = useChatStore((s) => s.saveDataSourcesToConversation)
  const isBusy = useIsCurrentSessionBusy()

  const basis = useMemo(
    () =>
      buildSourceBasis({
        sources: availableDataSources,
        enabledIds: enabledDataSourceIds,
        knowledgeLayerAvailable,
        hasValidToken: !!idToken,
        labels: {
          projectName: t('sourceBasis.knowledge.projectName'),
          projectDescription: t('sourceBasis.knowledge.projectDescription'),
          officeName: t('sourceBasis.knowledge.officeName'),
          officeDescription: t('sourceBasis.knowledge.officeDescription'),
          signInRequired: t('sourceBasis.signInReason'),
        },
      }),
    [availableDataSources, enabledDataSourceIds, knowledgeLayerAvailable, idToken, t]
  )

  const summary = useMemo(
    () => summariseBasis(basis, activeSourcePreset),
    [basis, activeSourcePreset]
  )

  const handleToggle = useCallback(
    (sourceId: string, enabled: boolean) => {
      const updatedIds = enabled
        ? [...enabledDataSourceIds, sourceId]
        : enabledDataSourceIds.filter((id) => id !== sourceId)
      toggleDataSource(sourceId)
      saveDataSourcesToConversation?.(updatedIds)
    },
    [toggleDataSource, enabledDataSourceIds, saveDataSourcesToConversation]
  )

  const handlePreset = useCallback(
    (value: string) => {
      const sources = availableDataSources ?? []
      const allIds = sources.map((s) => s.id)
      if (!value || value === ALL) {
        applySourcePreset(null, allIds)
        saveDataSourcesToConversation?.(allIds)
        return
      }
      const preset = value as SourcePresetId
      const nextIds = computePresetSourceIds(preset, sources)
      applySourcePreset(preset, nextIds)
      saveDataSourcesToConversation?.(nextIds)
    },
    [availableDataSources, applySourcePreset, saveDataSourcesToConversation]
  )

  const presetValue = activeSourcePreset ?? (summary.kind === 'all' ? ALL : '')
  const nothingExternal = hasNoExternalSources(basis)
  const isEmpty = basis.external.length === 0 && basis.always.length === 0

  return (
    <div className="flex max-h-[min(70dvh,460px)] flex-col gap-3">
      {/* The honest sentence, at the top — not a footnote under the fold. */}
      <Field className="gap-1">
        <div className="flex items-center gap-2">
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{t('sourceBasis.label')}</span>
        </div>
        <FieldDescription>{t('sourceBasis.description')}</FieldDescription>
      </Field>

      {isBusy && (
        <p className="text-xs text-muted-foreground" role="note">
          {t('sourceBasis.lockedBusy')}
        </p>
      )}

      <div className="scroll-fade-bottom min-h-0 flex-1 space-y-4 overflow-y-auto pb-1">
        {dataSourcesLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label={t('dataSources.loading')}>
            <Skeleton className="h-14 w-full rounded-control" />
            <Skeleton className="h-14 w-full rounded-control" />
            <Skeleton className="h-14 w-full rounded-control" />
          </div>
        ) : dataSourcesError ? (
          <Alert variant="destructive">
            <AlertDescription className="space-y-2">
              <span className="block">{t('dataSources.unableToLoad')}</span>
              <span className="block text-xs">{dataSourcesError}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchDataSources()}
                aria-label={t('dataSources.retryAria')}
              >
                {tc('actions.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {basis.always.length > 0 && (
              <section className="space-y-2">
                <SectionLabel as="h3">{t('sourceBasis.alwaysOn')}</SectionLabel>
                <ItemList as="ul" aria-label={t('sourceBasis.alwaysOn')}>
                  {basis.always.map((entry) => (
                    <SourceBasisRow key={entry.id} entry={entry} />
                  ))}
                </ItemList>
              </section>
            )}

            <section className="space-y-2">
              <SectionLabel as="h3">{t('sourceBasis.external')}</SectionLabel>
              {basis.external.length === 0 ? (
                <div className="rounded-surface border border-dashed bg-muted p-6 text-center">
                  <Layers className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium">{t('sourceBasis.emptyTitle')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('sourceBasis.emptyBody')}</p>
                </div>
              ) : (
                <ItemList as="ul" aria-label={t('sourceBasis.external')}>
                  {basis.external.map((entry) => (
                    <SourceBasisRow
                      key={entry.id}
                      entry={entry}
                      isBusy={isBusy}
                      onToggle={handleToggle}
                    />
                  ))}
                </ItemList>
              )}
            </section>

            {/* The case the composer's NoSourcesBanner cannot see: it
                short-circuits on `knowledgeLayerAvailable`, so switching off
                every external source is completely silent today. */}
            {nothingExternal && (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>{t('sourceBasis.noExternalWarning')}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>

      {/* Outside the fade: a footer must stay sharp. */}
      {!isEmpty && !dataSourcesError && (
        <div className="space-y-1.5 border-t pt-3">
          <SectionLabel as="h3">{t('sourceBasis.presetsLabel')}</SectionLabel>
          <ToggleGroup
            type="single"
            variant="inverted"
            size="sm"
            value={presetValue}
            onValueChange={handlePreset}
            disabled={isBusy}
            aria-label={t('sourceBasis.presetsLabel')}
          >
            <ToggleGroupItem value={ALL}>{t('sourceBasis.presets.all')}</ToggleGroupItem>
            {PRESETS.map((preset) => {
              const signal = preset === 'law' ? 'law' : preset === 'office' ? 'office' : 'project'
              const Icon = iconForTint(signal)
              return (
                <ToggleGroupItem key={preset} value={preset}>
                  <Icon aria-hidden="true" />
                  {t(`sourceBasis.presets.${preset}`)}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
      )}
    </div>
  )
}

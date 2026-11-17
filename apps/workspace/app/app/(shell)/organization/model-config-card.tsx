'use client'

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, History, RotateCcw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SearchField } from '@/components/ui/search-field'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { formatCredits } from '@/lib/format'
import { describeRejections, isZdrListUnavailableResponse } from '@/lib/model-config/rejections'
import { ZdrGroupNotice, ZdrPolicySection, type ZdrCoverage } from './zdr-policy-section'

interface AgentGroupDto {
  id: string
  label: string
  description: string
  requirements: { requiredParameters: string[]; minContextLength: number }
}

interface ModelDto {
  id: string
  name: string
  contextLength: number
  creditsPerRequest: number | null
  zdrSafe: boolean | null
}

type FailureKind = 'zdr_list_unavailable' | 'other'

async function failureKind(res: Response): Promise<FailureKind> {
  return (await isZdrListUnavailableResponse(res)) ? 'zdr_list_unavailable' : 'other'
}

async function rejectionText(res: Response, t: Translator, labelOf: (groupId: string) => string): Promise<string> {
  try {
    const body = (await res.json()) as { details?: unknown }
    return describeRejections(body.details, t, labelOf).join(' ')
  } catch {
    return ''
  }
}

interface VersionDto {
  id: string
  version: number
  overrides: Record<string, { model: string }>
  comment: string | null
  createdBy: string
  createdAt: string
}

const formatContext = (tokens: number): string =>
  tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens)

const ModelPicker: FC<{
  group: AgentGroupDto
  epoch: number
  onPick: (modelId: string) => void
}> = ({ group, epoch, onPick }) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()
  const [query, setQuery] = useState('')
  const [models, setModels] = useState<ModelDto[] | null>(null)
  const [failure, setFailure] = useState<FailureKind | null>(null)
  const [zdrFiltered, setZdrFiltered] = useState(false)
  const [loading, setLoading] = useState(true)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(
    (q: string) => {
      setLoading(true)
      fetch(`/api/organization/model-config/models?group=${encodeURIComponent(group.id)}&q=${encodeURIComponent(q)}`)
        .then(async (res) => {
          if (!res.ok) {
            setModels(null)
            setFailure(await failureKind(res))
            return
          }
          const body = (await res.json()) as { models: ModelDto[]; catalogSource?: { zdrOnly?: boolean } }
          setModels(body.models)
          setZdrFiltered(body.catalogSource?.zdrOnly === true)
          setFailure(null)
        })
        .catch(() => {
          setModels(null)
          setFailure('other')
        })
        .finally(() => setLoading(false))
    },
    [group.id],
  )

  useEffect(() => {
    search('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, epoch])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onQueryChange = (value: string): void => {
    setQuery(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => search(value), 300)
  }

  return (
    <div className="flex w-80 max-w-[calc(100vw-3rem)] flex-col">
      <SearchField
        type="text"
        value={query}
        onChange={onQueryChange}
        placeholder={t('models.searchPlaceholder')}
        label={t('models.searchPlaceholder')}
        inputRef={inputRef}
      />
      <ScrollArea className="mt-2 h-64">
        <div role="listbox">
          {loading && <Spinner className="mx-auto my-6" />}
          {!loading && models === null && (
            <p className="px-2 py-4 text-sm text-destructive">
              {failure === 'zdr_list_unavailable' ? t('models.zdrListUnavailable') : t('models.pickerLoadError')}
            </p>
          )}
          {!loading && models?.length === 0 && (
            <EmptyState variant="bare" title={zdrFiltered ? t('models.noZdrResults') : t('models.noResults')} />
          )}
          {!loading &&
            models?.map((model) => (
              <Item asChild key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="w-full flex-col items-start gap-0.5 px-2 py-1.5"
                  onClick={() => onPick(model.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-sm">{model.id}</span>
                    {model.zdrSafe === false && (
                      <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('models.contextWindow')} {formatContext(model.contextLength)}
                    {model.creditsPerRequest !== null &&
                      ` · ${t('models.creditsPerRequest', { credits: formatCredits(model.creditsPerRequest, locale) })}`}
                    {model.zdrSafe === false && ` · ${t('models.noZdrMark')}`}
                  </span>
                </button>
              </Item>
            ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export const ModelConfigCard: FC = () => {
  const t = useTranslations(organizationCopy)
  const tc = useTranslations(commonCopy)
  const { locale } = useLocale()
  const [groups, setGroups] = useState<AgentGroupDto[]>([])
  const [defaults, setDefaults] = useState<Record<string, string | null>>({})
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [pickerGroup, setPickerGroup] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [versionsFailed, setVersionsFailed] = useState(false)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [versions, setVersions] = useState<VersionDto[] | null>(null)
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [catalogSource, setCatalogSource] = useState<{ source: string; provider: string | null } | null>(null)
  const [zdrOnly, setZdrOnly] = useState(true)
  const [zdrApplicable, setZdrApplicable] = useState(true)
  const [zdrCoverage, setZdrCoverage] = useState<ZdrCoverage | null>(null)
  const [pendingActivate, setPendingActivate] = useState<VersionDto | 'none' | null>(null)
  const [catalogEpoch, setCatalogEpoch] = useState(0)

  const load = useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) setLoading(true)
    try {
      const res = await fetch('/api/organization/model-config')
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as {
        agentGroups: AgentGroupDto[]
        defaults: Record<string, string | null>
        catalogSource: { source: string; provider: string | null } | null
        zdrOnly?: boolean
        zdrApplicable?: boolean
        zdrCoverage?: ZdrCoverage | null
        activeVersion: VersionDto | null
      }
      setGroups(body.agentGroups)
      setDefaults(body.defaults ?? {})
      setCatalogSource(body.catalogSource ?? null)
      setZdrOnly(body.zdrOnly !== false)
      setZdrApplicable(body.zdrApplicable !== false)
      setZdrCoverage(body.zdrCoverage ?? null)
      const flat: Record<string, string> = {}
      for (const [groupId, value] of Object.entries(body.activeVersion?.overrides ?? {})) {
        if (value?.model) flat[groupId] = value.model
      }
      setSaved(flat)
      setDraft(flat)
      setActiveVersionId(body.activeVersion?.id ?? null)
      setLoadFailed(false)
    } catch {
      if (options?.quiet) toast.error(t('models.loadError'))
      else setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch('/api/organization/model-config/versions')
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { versions: VersionDto[]; activeVersionId: string | null }
      setVersions(body.versions)
      setActiveVersionId(body.activeVersionId)
      setVersionsFailed(false)
    } catch {
      setVersionsFailed(true)
    }
  }, [])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  const labelOf = useCallback(
    (groupId: string) => groups.find((group) => group.id === groupId)?.label ?? groupId,
    [groups],
  )

  const refusalMessage = useCallback(
    async (res: Response, fallback: string): Promise<string> => {
      if (res.status === 422) return `${fallback} ${await rejectionText(res, t, labelOf)}`.trim()
      if ((await failureKind(res)) === 'zdr_list_unavailable') return t('models.saveErrorZdrUnavailable')
      return fallback
    },
    [t, labelOf],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const overrides = Object.fromEntries(Object.entries(draft).map(([g, model]) => [g, { model }]))
      const res = await fetch('/api/organization/model-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides, comment: comment.trim() || null }),
      })
      if (!res.ok) {
        toast.error(await refusalMessage(res, t('models.saveError')))
        return
      }
      toast.success(t('models.saved'))
      setComment('')
      await load()
      if (historyOpen) await loadVersions()
    } catch {
      toast.error(t('models.saveError'))
    } finally {
      setSaving(false)
    }
  }, [draft, comment, t, load, loadVersions, historyOpen, refusalMessage])

  const handleActivate = useCallback(
    async (versionId: string | 'none') => {
      try {
        const res = await fetch(`/api/organization/model-config/versions/${versionId}/activate`, { method: 'POST' })
        if (!res.ok) {
          toast.error(await refusalMessage(res, t('models.activateError')))
          return
        }
        await load()
        await loadVersions()
      } catch {
        toast.error(t('models.activateError'))
      }
    },
    [t, load, loadVersions, refusalMessage],
  )

  const onZdrChanged = useCallback(async () => {
    setPickerGroup(null)
    await load({ quiet: true })
    setCatalogEpoch((n) => n + 1)
  }, [load])

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-72" />
            </div>
            <Skeleton className="h-8 w-52" />
          </div>
        ))}
      </div>
    )
  }

  if (loadFailed) {
    return (
      <LoadError title={t('models.loadError')} onRetry={load} />
    )
  }

  const activateTargetLabel =
    pendingActivate === 'none'
      ? t('models.defaultsTarget')
      : pendingActivate
        ? `${t('models.version')} ${pendingActivate.version}`
        : ''

  return (
    <div className="flex flex-col gap-4">
      {/* Activating a version / resetting to defaults swaps the production model
          for the whole org immediately — name the target and confirm. */}
      <ConfirmDialog
        open={pendingActivate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingActivate(null)
        }}
        title={t('models.activateTitle')}
        description={t('models.activateDescription', { target: activateTargetLabel })}
        confirmLabel={t('models.activateConfirm')}
        cancelLabel={tc('actions.cancel')}
        tone="warning"
        onConfirm={() =>
          handleActivate(pendingActivate === 'none' ? 'none' : (pendingActivate?.id ?? 'none'))
        }
      />
      <ZdrPolicySection
        zdrOnly={zdrOnly}
        zdrApplicable={zdrApplicable}
        provider={catalogSource?.provider ?? null}
        coverage={zdrCoverage}
        onChanged={onZdrChanged}
      />

      {/* BYOK (ADR-0022): the picker lists the org's own provider models. */}
      {catalogSource?.source === 'byok' && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('models.byokCatalogHint', { provider: catalogSource.provider ?? 'BYOK' })}
        </p>
      )}
      <ul className="flex flex-col divide-y">
        {groups.map((group) => {
          const override = draft[group.id]
          const defaultModel = defaults[group.id]
          return (
            <li key={group.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-x-4">
              <div className="min-w-0 sm:flex-1">
                <p className="text-sm font-medium">{group.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                {zdrOnly && zdrApplicable && <ZdrGroupNotice groupId={group.id} coverage={zdrCoverage} />}
              </div>
              <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
                {override ? (
                  <Badge variant="secondary" className="font-normal">
                    {t('models.overrideBadge')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {t('models.defaultBadge')}
                  </Badge>
                )}
                <code
                  className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs sm:max-w-56 sm:flex-none"
                  title={override ?? defaultModel ?? undefined}
                >
                  {override ?? defaultModel ?? t('models.defaultModel')}
                </code>
                {override && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title={t('models.resetToDefault')}
                    aria-label={`${t('models.resetToDefault')}: ${group.label}`}
                    onClick={() =>
                      setDraft((prev) => {
                        const next = { ...prev }
                        delete next[group.id]
                        return next
                      })
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                  </Button>
                )}
                <Popover
                  open={pickerGroup === group.id}
                  onOpenChange={(open) => setPickerGroup(open ? group.id : null)}
                >
                  <PopoverTrigger asChild>
                    <Button variant="secondary" size="sm">
                      {t('models.change')}
                      <ChevronDown className="ml-1 size-3.5" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto p-3">
                    <ModelPicker
                      group={group}
                      epoch={catalogEpoch}
                      onPick={(modelId) => {
                        setDraft((prev) => ({ ...prev, [group.id]: modelId }))
                        setPickerGroup(null)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </li>
          )
        })}
      </ul>

      {dirty && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">{t('models.unsavedChanges')}</p>
          <Field>
            <FieldLabel htmlFor="model-config-comment">{t('models.comment')}</FieldLabel>
            <Input
              id="model-config-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('models.commentPlaceholder')}
              maxLength={500}
            />
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button className="w-full sm:w-auto" onClick={handleSave} disabled={saving}>
              {saving ? t('models.saving') : t('models.save')}
            </Button>
            <Button className="w-full sm:w-auto" variant="ghost" onClick={() => setDraft(saved)} disabled={saving}>
              {t('models.discard')}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      <Collapsible
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open)
          if (open && versions === null) void loadVersions()
        }}
      >
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-quick ease-out hover:text-foreground">
          <History className="size-4" aria-hidden />
          {t('models.history')}
          <ChevronDown className="size-3.5 transition-transform duration-quick ease-out motion-reduce:transition-none group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 flex flex-col gap-2">
            {versions === null && !versionsFailed && <Spinner className="mx-auto my-4" />}
            {versions === null && versionsFailed && (
              <LoadError title={t('models.loadError')} onRetry={loadVersions} />
            )}
            {versions !== null && versions.length === 0 && (
              <EmptyState variant="bare" title={t('models.historyEmpty')} />
            )}
            {versions !== null && versions.length > 0 && activeVersionId !== null && (
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setPendingActivate('none')}>
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                {t('models.useDefaults')}
              </Button>
            )}
            {versions?.map((version) => (
              <div key={version.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {t('models.version')} {version.version}
                    {version.id === activeVersionId && <Badge variant="secondary">{t('models.activeBadge')}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString(locale)}
                  </span>
                </div>
                {version.comment && <p className="mt-1 text-xs text-muted-foreground">{version.comment}</p>}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(version.overrides).map(([groupId, value]) => (
                    <li key={groupId}>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {groupId}: {value.model}
                      </code>
                    </li>
                  ))}
                </ul>
                {version.id !== activeVersionId && (
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => setPendingActivate(version)}>
                    {t('models.activate')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

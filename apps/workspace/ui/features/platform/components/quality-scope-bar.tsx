'use client'

import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { formatDayRange } from '@/lib/format'
import {
  isIsoDay,
  matchingPreset,
  presetRange,
  QUALITY_MAX_RANGE_DAYS,
  QUALITY_RANGE_PRESETS,
  qualityScopeQuery,
  rangeDays,
  utcDay,
  type QualityScope,
} from '@/lib/quality/scope'
import { getQualityScopeOptions, type QualityScopeOptions } from '@/adapters/api/quality-scope-client'

export interface QualityScopeBarProps {
  scope: QualityScope
  onScopeChange: (next: QualityScope) => void
  options: QualityScopeOptionsState
}

export interface QualityScopeOptionsState {
  options: QualityScopeOptions | null
  loading: boolean
  failed: boolean
}

export function customRangeError(from: string, to: string): 'invalid' | 'inverted' | 'tooLong' | null {
  if (!isIsoDay(from) || !isIsoDay(to)) return 'invalid'
  if (from > to) return 'inverted'
  if (rangeDays(from, to) > QUALITY_MAX_RANGE_DAYS) return 'tooLong'
  return null
}

export function withOrganizations(
  scope: QualityScope,
  organizationIds: string[],
  projectOrganization: ReadonlyMap<string, string>
): QualityScope {
  const chosen = new Set(organizationIds)
  const projectIds =
    organizationIds.length === 0
      ? []
      : scope.projectIds.filter((id) => {
          const owner = projectOrganization.get(id)
          return owner === undefined || chosen.has(owner)
        })
  return { ...scope, organizationIds, projectIds }
}

export function useQualityScopeOptions(scope: QualityScope): QualityScopeOptionsState {
  const [state, setState] = useState<QualityScopeOptionsState>({ options: null, loading: true, failed: false })
  const search = qualityScopeQuery(scope)
  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, loading: true, failed: false }))
    getQualityScopeOptions(search, { signal: controller.signal })
      .then((body) => {
        if (!controller.signal.aborted) setState({ options: body, loading: false, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, loading: false, failed: true }))
      })
    return () => controller.abort()
  }, [search])
  return state
}

export function QualityScopeBar({ scope, onScopeChange, options: state }: QualityScopeBarProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const { options, loading, failed } = state

  const organizationOptions = useMemo<MultiSelectOption[]>(
    () => (options?.organizations ?? []).map((org) => ({ value: org.id, label: org.name ?? org.id })),
    [options]
  )
  const organizationName = useMemo(
    () => new Map(organizationOptions.map((option) => [option.value, option.label])),
    [organizationOptions]
  )
  const projectOrganization = useMemo(
    () => new Map((options?.projects ?? []).map((project) => [project.id, project.organizationId])),
    [options]
  )
  const projectOptions = useMemo<MultiSelectOption[]>(
    () =>
      (options?.projects ?? [])
        .filter((project) => scope.organizationIds.includes(project.organizationId))
        .map((project) => ({
          value: project.id,
          label: project.name,
          hint: scope.organizationIds.length > 1 ? organizationName.get(project.organizationId) : undefined,
        })),
    [options, scope.organizationIds, organizationName]
  )
  const projectName = useMemo(
    () => new Map((options?.projects ?? []).map((project) => [project.id, project.name])),
    [options]
  )

  const preset = matchingPreset(scope)
  const noOrganization = scope.organizationIds.length === 0

  return (
    <div
      className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:gap-4"
      role="group"
      aria-label={t('qualityWorkspace.scope.label')}
      data-testid="quality-scope-bar"
    >
      <Field className="md:w-auto">
        <FieldLabel>{t('qualityWorkspace.scope.range')}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            segmented
            value={preset ? String(preset) : ''}
            onValueChange={(value) => {
              if (!value) return
              onScopeChange({ ...scope, ...presetRange(Number(value)) })
            }}
            aria-label={t('qualityWorkspace.scope.range')}
            data-testid="quality-range-presets"
          >
            {QUALITY_RANGE_PRESETS.map((days) => (
              <ToggleGroupItem key={days} value={String(days)} className="px-3 tabular-nums">
                {t('qualityWorkspace.scope.presetDays', { count: days })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <CustomRange
            scope={scope}
            active={preset === null}
            label={preset === null ? formatDayRange(scope.from, scope.to, locale) : t('qualityWorkspace.scope.custom')}
            onApply={(range) => onScopeChange({ ...scope, ...range })}
          />
        </div>
      </Field>

      <Field className="md:w-72">
        <FieldLabel htmlFor="quality-scope-orgs">{t('qualityWorkspace.scope.organizations')}</FieldLabel>
        <MultiSelect
          id="quality-scope-orgs"
          data-testid="quality-scope-orgs"
          label={t('qualityWorkspace.scope.organizations')}
          placeholder={t('qualityWorkspace.scope.allOrganizations')}
          searchPlaceholder={t('qualityWorkspace.scope.searchOrganizations')}
          emptyText={t('qualityWorkspace.scope.noOrganizations')}
          options={organizationOptions}
          value={scope.organizationIds}
          loading={loading && !options}
          labelFor={(id) => organizationName.get(id) ?? id}
          removeLabel={(label) => t('answerFeedback.filters.remove', { label })}
          moreLabel={(count) => t('answerFeedback.filters.more', { count })}
          maxChips={2}
          searchable
          onValueChange={(next) => onScopeChange(withOrganizations(scope, next, projectOrganization))}
        />
        {failed ? <FieldError>{t('qualityWorkspace.scope.optionsFailed')}</FieldError> : null}
      </Field>

      <Field className="md:w-72">
        <FieldLabel htmlFor="quality-scope-projects">{t('qualityWorkspace.scope.projects')}</FieldLabel>
        <MultiSelect
          id="quality-scope-projects"
          data-testid="quality-scope-projects"
          label={t('qualityWorkspace.scope.projects')}
          placeholder={
            noOrganization
              ? t('qualityWorkspace.scope.projectsNeedOrganization')
              : t('qualityWorkspace.scope.allProjects')
          }
          searchPlaceholder={t('qualityWorkspace.scope.searchProjects')}
          emptyText={t('qualityWorkspace.scope.noProjects')}
          options={projectOptions}
          value={scope.projectIds}
          disabled={noOrganization}
          loading={loading && !options}
          labelFor={(id) => projectName.get(id) ?? id}
          removeLabel={(label) => t('answerFeedback.filters.remove', { label })}
          moreLabel={(count) => t('answerFeedback.filters.more', { count })}
          maxChips={2}
          searchable
          onValueChange={(next) => onScopeChange({ ...scope, projectIds: next })}
        />
      </Field>
    </div>
  )
}

function CustomRange({
  scope,
  active,
  label,
  onApply,
}: {
  scope: QualityScope
  active: boolean
  label: string
  onApply: (range: { from: string; to: string }) => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(scope.from)
  const [to, setTo] = useState(scope.to)
  const error = customRangeError(from, to)
  const today = utcDay(new Date())

  const message =
    error === 'inverted'
      ? t('qualityWorkspace.scope.rangeInverted')
      : error === 'tooLong'
        ? t('qualityWorkspace.scope.rangeTooLong', { max: QUALITY_MAX_RANGE_DAYS })
        : error === 'invalid'
          ? t('qualityWorkspace.scope.rangeInvalid')
          : null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(scope.from)
          setTo(scope.to)
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={active}
          data-testid="quality-range-custom"
          className="tabular-nums aria-pressed:bg-selected aria-pressed:hover:bg-selected"
        >
          <CalendarRange className="size-3.5" aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} className="w-72">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (error) return
            onApply({ from, to })
            setOpen(false)
          }}
        >
          <Field>
            <FieldLabel htmlFor="quality-range-from">{t('qualityWorkspace.scope.from')}</FieldLabel>
            <Input
              id="quality-range-from"
              type="date"
              value={from}
              max={today}
              onChange={(event) => setFrom(event.target.value)}
              aria-invalid={error === 'inverted' || undefined}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="quality-range-to">{t('qualityWorkspace.scope.to')}</FieldLabel>
            <Input
              id="quality-range-to"
              type="date"
              value={to}
              max={today}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={error === 'inverted' || undefined}
            />
          </Field>
          {message ? <FieldError>{message}</FieldError> : null}
          <Button type="submit" size="sm" disabled={error !== null} data-testid="quality-range-apply">
            {t('qualityWorkspace.scope.apply')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Ruler, Sparkles, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimProfileSuggestion } from '@/lib/bim/profile'
import { capturePosthog } from '@/lib/analytics/posthog'
import {
  BIM_TAKEOFF_DIMENSION,
  BIM_TAKEOFF_QUANTITIES,
  roomScheduleToCsv,
  type BimQuantityRow,
  type BimRoomSchedule,
} from '@/lib/bim/schedule'

function PanelError({ text, onRetry }: { text: string; onRetry?: () => void }): JSX.Element {
  const t = useTranslations(bimCopy)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-destructive text-sm">{text}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRetry}>
          {t('loadFailed.action')}
        </Button>
      )}
    </div>
  )
}

const VISIBLE_ROOMS = 60

const VISIBLE_TAKEOFF_ROWS = 40

function useNumberFormat(): (value: number | null, digits?: number) => string {
  const { locale } = useLocale()
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    return (value, digits = 2) => (value === null ? '—' : (digits === 0 ? integer : format).format(value))
  }, [locale])
}

export interface IfcRoomScheduleProps {
  truncated?: boolean
  schedule: BimRoomSchedule | null
  isLoading: boolean
  error: string | null
  onRetry?: () => void
  filename: string
  onSelect?: (globalId: string) => void
  selectedGlobalId?: string | null
}

export function IfcRoomSchedule({
  truncated = false,
  schedule,
  isLoading,
  error,
  onRetry,
  filename,
  onSelect,
  selectedGlobalId,
}: IfcRoomScheduleProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const format = useNumberFormat()
  const [expanded, setExpanded] = useState(false)

  const download = (): void => {
    if (!schedule) return
    const blob = new Blob([`\uFEFF${roomScheduleToCsv(schedule, { truncated })}`], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${filename.replace(/\.(ifc|ifczip)$/i, '')}-raumbuch.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    capturePosthog('report_exported', { kind: 'room_schedule', format: 'csv' })
  }

  const totalRooms = schedule?.totals.rooms ?? 0
  let rendered = 0

  return (
    <section aria-labelledby="bim-schedule-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bim-schedule-heading" className="flex items-center gap-2 text-sm font-medium">
          <Table2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('schedule.title')}
        </h2>
        {schedule && schedule.totals.rooms > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={download}>
            <Download className="size-3.5" aria-hidden="true" />
            {t('schedule.download')}
          </Button>
        )}
      </div>

      {isLoading && <Spinner className="size-4" />}
      {error && <PanelError text={t('schedule.failed')} onRetry={onRetry} />}

      {schedule && schedule.totals.rooms === 0 && (
        <p className="text-sm text-muted-foreground">{t('schedule.empty')}</p>
      )}

      {schedule && schedule.totals.rooms > 0 && (
        <>
          {/* Above the rows on purpose: it invalidates the `Gesamt` below. */}
          {truncated && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('schedule.truncated')}
            </p>
          )}
          {schedule.totals.roomsWithoutArea > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warning-subtle p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('schedule.missing', { count: schedule.totals.roomsWithoutArea })}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    {t('schedule.room')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {/* The unit only when the model declared one: `()` with
                        nothing in it reads as a column that lost its unit. */}
                    {t('schedule.netArea')}
                    {schedule.units.area && ` (${schedule.units.area})`}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {t('schedule.volume')}
                    {schedule.units.volume && ` (${schedule.units.volume})`}
                  </th>
                </tr>
              </thead>
              {schedule.storeys.map((storey) => {
                const visible = expanded
                  ? storey.rooms
                  : storey.rooms.slice(0, Math.max(0, VISIBLE_ROOMS - rendered))
                rendered += visible.length
                const elided = storey.rooms.length - visible.length
                return (
                  <tbody key={storey.storeyName} className="border-t">
                    <tr className="bg-accent">
                      {/*
                        `rowgroup`, not `colgroup`. A colgroup header claims to
                        head the rest of a COLUMN, so the rooms beneath were
                        never associated with their storey — reading the
                        Raumbuch cell by cell gave no way to tell which floor a
                        room is on, which is the first thing the table sorts by.
                      */}
                      <th
                        scope="rowgroup"
                        colSpan={3}
                        className="px-2 py-1 text-left text-xs font-medium"
                      >
                        {storey.storeyName}
                        {storey.roomsWithoutArea > 0 && (
                          <span className="ml-2 font-normal text-warning">
                            {t('schedule.storeyMissing', { count: storey.roomsWithoutArea })}
                          </span>
                        )}
                      </th>
                    </tr>
                    {visible.map((room) => (
                      <tr
                        key={room.globalId}
                        onClick={onSelect ? () => onSelect(room.globalId) : undefined}
                        className={`border-t ${
                          onSelect
                            ? 'cursor-pointer transition-colors duration-quick ease-out hover:bg-hover motion-reduce:transition-none'
                            : ''
                        } ${room.globalId === selectedGlobalId ? 'bg-selected hover:bg-selected' : ''}`}
                      >
                        <td className="px-2 py-1">
                          {/*
                            A real button, the way the element table does it.
                            A `<tr onClick>` is reachable by nothing else — no
                            Tab stop, no Enter, nothing announced — so the
                            Raumbuch was the one table on this page a keyboard
                            could not select from.

                            `aria-current` rather than `aria-selected` on the
                            row: a `role="row"` inside a `role="table"` does
                            not support `aria-selected`, so the selected room
                            was conveyed by a background colour and nothing
                            else.
                          */}
                          {onSelect ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onSelect(room.globalId)
                              }}
                              aria-current={room.globalId === selectedGlobalId}
                              className="rounded-sm text-left focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
                            >
                              {room.name}
                            </button>
                          ) : (
                            room.name
                          )}
                          {room.category && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {room.category}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {format(room.netFloorArea)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {format(room.netVolume)}
                        </td>
                      </tr>
                    ))}
                    {elided > 0 && (
                      <tr className="border-t">
                        <td colSpan={3} className="text-muted-foreground px-2 py-1 text-xs italic">
                          {elided === 1
                            ? t('schedule.storeyElidedOne')
                            : t('schedule.storeyElided', { count: elided })}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t bg-muted text-xs font-medium">
                      <td className="px-2 py-1">{t('schedule.storeyTotal')}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format(storey.netFloorArea)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format(storey.netVolume)}
                      </td>
                    </tr>
                  </tbody>
                )
              })}
              <tfoot className="border-t-2">
                <tr className="text-sm font-medium">
                  <td className="px-2 py-1.5">{t('schedule.total')}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {format(schedule.totals.netFloorArea)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {format(schedule.totals.netVolume)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {totalRooms > VISIBLE_ROOMS && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded
                ? t('schedule.collapse')
                : totalRooms - VISIBLE_ROOMS === 1
                  ? t('schedule.expandOne')
                  : t('schedule.expand', { count: totalRooms - VISIBLE_ROOMS })}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

export interface IfcQuantityTakeoffProps {
  truncated?: boolean
  rows: BimQuantityRow[] | null
  isLoading: boolean
  error: string | null
  onRetry?: () => void
  quantity: string
  onQuantityChange: (quantity: string) => void
  byMaterial: boolean
  onByMaterialChange: (byMaterial: boolean) => void
  units: { area: string; volume: string; length: string }
}

export function IfcQuantityTakeoff({
  truncated = false,
  rows,
  isLoading,
  error,
  onRetry,
  quantity,
  onQuantityChange,
  byMaterial,
  onByMaterialChange,
  units,
}: IfcQuantityTakeoffProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const format = useNumberFormat()
  const quantityUnit = units[BIM_TAKEOFF_DIMENSION[quantity] ?? 'area'] ?? ''
  const incomplete = (rows ?? []).reduce((sum, row) => sum + row.missing, 0)
  const [expandedRows, setExpandedRows] = useState(false)
  const visibleRows = expandedRows ? (rows ?? []) : (rows ?? []).slice(0, VISIBLE_TAKEOFF_ROWS)

  return (
    <section aria-labelledby="bim-takeoff-heading" className="space-y-2">
      <h2 id="bim-takeoff-heading" className="flex items-center gap-2 text-sm font-medium">
        <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('takeoff.title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('takeoff.description')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Field orientation="horizontal" className="items-center gap-2">
          <FieldLabel htmlFor="bim-takeoff-quantity" className="text-muted-foreground">
            {t('takeoff.quantity')}
          </FieldLabel>
          <Select value={quantity} onValueChange={onQuantityChange}>
            <SelectTrigger id="bim-takeoff-quantity" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BIM_TAKEOFF_QUANTITIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`takeoff.quantityName.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal" className="items-center gap-2">
          <Checkbox
            id="bim-takeoff-by-material"
            checked={byMaterial}
            onCheckedChange={(checked) => onByMaterialChange(checked === true)}
          />
          <FieldLabel htmlFor="bim-takeoff-by-material" className="text-muted-foreground font-normal">
            {t('takeoff.byMaterial')}
          </FieldLabel>
        </Field>
      </div>

      {isLoading && <Spinner className="size-4" />}
      {error && <PanelError text={t('takeoff.failed')} onRetry={onRetry} />}

      {rows && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('takeoff.empty')}</p>
      )}

      {rows && rows.length > 0 && (
        <>
          {truncated && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('takeoff.truncated')}
            </p>
          )}
          {incomplete > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warning-subtle p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('takeoff.missing', { count: incomplete })}
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    {t('takeoff.group')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {t('takeoff.elements')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {t(`takeoff.quantityName.${quantity}`)}
                    {quantityUnit && ` (${quantityUnit})`}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.group} className="border-t">
                    <td className="px-2 py-1">{row.group}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {format(row.elements, 0)}
                      {row.missing > 0 && (
                        <span className="ml-1 text-xs text-warning">
                          {t('takeoff.rowMissing', { count: row.missing })}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{format(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
            A toggle, like the Raumbuch's above it. It used to only expand,
            which deleted the button the reader had just pressed: focus fell
            out of the table, nothing announced that a few hundred rows had
            appeared, and there was no way back to the short list.
          */}
          {(rows?.length ?? 0) > VISIBLE_TAKEOFF_ROWS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpandedRows(!expandedRows)}
              className="w-full"
            >
              {expandedRows
                ? t('takeoff.collapse')
                : (rows?.length ?? 0) - visibleRows.length === 1
                  ? t('takeoff.showAllOne')
                  : t('takeoff.showAll', { count: (rows?.length ?? 0) - visibleRows.length })}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

export interface IfcProfileSuggestionsProps {
  suggestions: BimProfileSuggestion[] | null
  isLoading: boolean
  error: string | null
  onRetry?: () => void
  askHref: string | null
}

const CONFIDENCE_VARIANT: Record<BimProfileSuggestion['confidence'], 'success' | 'warning' | 'secondary'> =
  {
    high: 'success',
    medium: 'warning',
    low: 'secondary',
  }

export function IfcProfileSuggestions({
  suggestions,
  isLoading,
  error,
  onRetry,
  askHref,
}: IfcProfileSuggestionsProps): JSX.Element {
  const t = useTranslations(bimCopy)

  return (
    <section aria-labelledby="bim-profile-heading" className="space-y-2">
      <h2 id="bim-profile-heading" className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('profile.title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('profile.description')}</p>

      {isLoading && <Spinner className="size-4" />}
      {error && <PanelError text={t('profile.failed')} onRetry={onRetry} />}

      {suggestions && suggestions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('profile.empty')}</p>
      )}

      {suggestions && suggestions.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {suggestions.map((suggestion) => (
              <li key={suggestion.key} className="rounded-lg border p-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t(`profile.key.${suggestion.key}`)}</span>
                  <span className="tabular-nums">{String(suggestion.value)}</span>
                  <Badge variant={CONFIDENCE_VARIANT[suggestion.confidence]}>
                    {t(`profile.confidence.${suggestion.confidence}`)}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.evidence}</p>
              </li>
            ))}
          </ul>
          {/*
            No Apply button here on purpose. These are inferences from an export
            that may be a working file, and `storeys_above_ground` picks a
            Gebäudeklasse — so they go through the same confirm-the-patch card
            every other agent-proposed brief change uses (ADR-0030), rather than
            being written by a button that looks like a checkbox.
          */}
          {/* Omitted rather than disabled where there is no conversation to ask
              in: a button that cannot go anywhere is not an affordance. */}
          {askHref && (
            <Button asChild size="sm" variant="secondary">
              <a href={askHref}>{t('profile.ask')}</a>
            </Button>
          )}
        </>
      )}
    </section>
  )
}

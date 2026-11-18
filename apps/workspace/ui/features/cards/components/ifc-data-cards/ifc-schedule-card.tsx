'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { Download, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { roomScheduleToCsv, type BimRoomSchedule } from '@/lib/bim/schedule'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { capturePosthog } from '@/lib/analytics/posthog'
import { useModelQuery } from '../../hooks/use-model-query'
import { useResolvedModel } from '../../hooks/use-resolved-model'
import { CardShell } from './card-shell'
import { NoModel } from './no-model'
import { TOUCH_LINK } from './touch-link'

const pickSchedule = (payload: Record<string, unknown>) =>
  payload.schedule
    ? {
        schedule: payload.schedule as BimRoomSchedule,
        truncated: payload.truncated === true,
      }
    : undefined

export interface IfcScheduleCardProps {
  title: string
  modelFile: string | null
  storey: string | null
  note: string | null
  projectId: string | null
}

export function IfcScheduleCard({
  title,
  modelFile,
  storey,
  note,
  projectId,
}: IfcScheduleCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const {
    model,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const { data: payload, isLoading, error } = useModelQuery(
    model?.id ?? null,
    { op: 'schedule' },
    pickSchedule
  )
  const schedule = payload?.schedule ?? null

  const storeys = useMemo(() => {
    if (!schedule) return []
    if (!storey) return schedule.storeys
    const needle = storey.toLowerCase()
    return schedule.storeys.filter((entry) => entry.storeyName.toLowerCase() === needle)
  }, [schedule, storey])

  const number = (value: number | null) =>
    value === null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 2 })

  const download = () => {
    if (!schedule) return
    const csv = roomScheduleToCsv(
      { ...schedule, storeys },
      { storeyFilter: storey, truncated: payload?.truncated === true }
    )
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(model?.filename ?? 'modell').replace(/\.(ifc|ifczip)$/i, '')}-raumbuch.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    capturePosthog('report_exported', { kind: 'room_schedule', format: 'csv' })
  }

  return (
    <CardShell
      title={title}
      icon={Table2}
      action={
        schedule &&
        storeys.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={download}>
            <Download className="size-3.5" aria-hidden="true" />
            CSV
          </Button>
        )
      }
    >
      {!model ? (
        <NoModel isLoading={modelsLoading} error={modelsError} ambiguous={ambiguous} notReady={notReady} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-sm text-destructive">{t('schedule.failed')}</p>
      ) : !schedule || schedule.totals.rooms === 0 ? (
        <EmptyState title={t('schedule.empty')} />
      ) : storeys.length === 0 ? (
        <EmptyState title={t('schedule.storeyEmpty', { storey: storey ?? '' })} />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('schedule.room')}
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    {t('schedule.netArea')}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t('schedule.volume')}
                  </th>
                </tr>
              </thead>
              {storeys.map((entry) => (
                <tbody key={entry.storeyName}>
                  <tr className="border-t">
                    <th scope="rowgroup" colSpan={3} className="pt-2 text-left text-xs font-medium">
                      {entry.storeyName}
                    </th>
                  </tr>
                  {entry.rooms.map((room) => (
                    <tr key={room.globalId} className="border-t/50">
                      <td className="py-1 pr-2">
                        {projectId ? (
                          <Link
                            href={buildModelHref(projectId, {
                              model: model.filename,
                              storey: entry.storeyName,
                              element: room.globalId,
                            })}
                            className={`underline-offset-2 hover:underline ${TOUCH_LINK}`}
                          >
                            {room.name}
                          </Link>
                        ) : (
                          room.name
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{number(room.netFloorArea)}</td>
                      <td className="py-1 text-right tabular-nums">{number(room.netVolume)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-1 pr-2">{t('schedule.storeyTotal')}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{number(entry.netFloorArea)}</td>
                    <td className="py-1 text-right tabular-nums">{number(entry.netVolume)}</td>
                  </tr>
                </tbody>
              ))}
              {/*
                Only when the table IS the building. With `storey` set the rows
                are one floor and `schedule.totals` is still the whole model,
                so a row labelled "Gesamt" under a single storey's rooms
                reported the building's Netto-Grundfläche as that floor's —
                the one number in this product that could do real damage, in
                the surface that ends up pasted into an email.
              */}
              {!storey && (
                <tfoot>
                  <tr className="border-t-2 font-medium">
                    <td className="py-1 pr-2">{t('schedule.total')}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {number(schedule.totals.netFloorArea)} {schedule.units.area}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {number(schedule.totals.netVolume)} {schedule.units.volume}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {payload?.truncated && (
            <p className="text-xs text-destructive">{t('schedule.truncated')}</p>
          )}
          {schedule.totals.roomsWithoutArea > 0 && (
            <p className="text-xs text-warning">
              {t('schedule.missing', { count: schedule.totals.roomsWithoutArea })}
            </p>
          )}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
      )}
    </CardShell>
  )
}

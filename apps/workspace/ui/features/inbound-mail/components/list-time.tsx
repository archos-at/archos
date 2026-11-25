'use client'

import { useEffect, useState, type JSX } from 'react'
import { OFFICE_TIME_ZONE, formatAbsoluteTime } from '@/lib/format'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const dayKey = (date: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: OFFICE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

/** A list's time, short as a mail program's: „10:48“ today, „gestern“, then „13.11.“. The full time is its title. */
export function ListTime({ date, locale }: { date: string; locale: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])
  const at = new Date(date)
  const full = formatAbsoluteTime(date, locale, OFFICE_TIME_ZONE)
  let text = new Intl.DateTimeFormat(locale, { timeZone: OFFICE_TIME_ZONE, day: '2-digit', month: '2-digit' }).format(at)
  if (now !== null && dayKey(at) === dayKey(new Date(now))) text = new Intl.DateTimeFormat(locale, { timeZone: OFFICE_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(at)
  else if (now !== null && dayKey(at) === dayKey(new Date(now - 86_400_000))) text = t('row.yesterday')
  return (
    <time dateTime={date} title={full} className="text-muted-foreground shrink-0 text-xs tabular-nums" data-testid="inbound-mail-row-time">
      {text}
    </time>
  )
}

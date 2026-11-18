'use client'

import type { JSX } from 'react'
import { formatRelativeTime } from '@/lib/format'

export function UtcTime({ iso, locale }: { iso: string; locale: string }): JSX.Element {
  const date = new Date(iso)
  const absolute = Number.isNaN(date.getTime())
    ? iso
    : `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`
  return (
    <time dateTime={iso} title={absolute} className="whitespace-nowrap tabular-nums">
      {formatRelativeTime(iso, locale)}
    </time>
  )
}

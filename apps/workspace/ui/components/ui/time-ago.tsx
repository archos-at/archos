'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { OFFICE_TIME_ZONE, formatAbsoluteTime, formatRelativeTime } from '@/lib/format'

export function TimeAgo({
  date,
  locale,
  className,
  short = false,
}: {
  date: string
  locale: string
  className?: string
  short?: boolean
}): JSX.Element {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <time dateTime={date} title={formatAbsoluteTime(date, locale, OFFICE_TIME_ZONE)} className={className}>
      {mounted ? formatRelativeTime(date, locale, Date.now(), short ? 'short' : 'long') : formatAbsoluteTime(date, locale, OFFICE_TIME_ZONE)}
    </time>
  )
}

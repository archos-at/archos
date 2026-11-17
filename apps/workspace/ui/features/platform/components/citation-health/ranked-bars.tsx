'use client'

import type { JSX } from 'react'

export function RankedBars({
  rows,
  format,
}: {
  rows: { key: string; label: string; sublabel?: string; value: number }[]
  format: (value: number) => string
}): JSX.Element {
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <ul className="usage-viz flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={row.label}>
              {row.label}
              {row.sublabel ? (
                <span className="text-muted-foreground text-xs"> · {row.sublabel}</span>
              ) : null}
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{format(row.value)}</span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="h-1.5 rounded-full"
              style={{
                backgroundColor: 'var(--chart-series-1)',
                width: `${Math.max((row.value / max) * 100, 2)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

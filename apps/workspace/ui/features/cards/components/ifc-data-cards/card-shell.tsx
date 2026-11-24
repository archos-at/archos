'use client'

import type { JSX } from 'react'
import type { Boxes } from 'lucide-react'

export function CardShell({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string
  icon: typeof Boxes
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="rounded-surface border bg-card p-5" aria-label={title}>
      {/* `flex-wrap`: the compliance card carries two actions, and beside the
          title they pushed the header 104px past a phone's edge. Wrapped, they
          take a line of their own under the title and stay beside it where
          there is room. */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

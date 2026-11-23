'use client'

import type { JSX, ReactNode } from 'react'

import { ShortcutKeys } from '@/components/shell/shortcut-keys'
import { MOD, type KeySegment } from '@/components/shell/shortcuts'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'

export function SearchFrame({ toolbar, rail, children }: { toolbar: ReactNode; rail: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="search-frame">
      <div className="flex min-w-0 flex-col gap-3">{toolbar}</div>
      <div className="flex min-w-0 flex-col gap-6 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:items-start md:gap-0">
        {rail ? (
          <aside
            className="hidden min-w-0 flex-col gap-1 md:sticky md:top-4 md:flex md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:border-r md:pr-3"
            data-testid="search-rail"
          >
            {rail}
          </aside>
        ) : null}
        <div className="flex min-w-0 flex-col gap-3 md:pl-6">{children}</div>
      </div>
    </div>
  )
}

export function SearchToolbar({ field, controls }: { field: ReactNode; controls: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="search-toolbar">
      <div className="min-w-0 flex-[1_1_20rem]">{field}</div>
      <div className="flex flex-wrap items-center gap-2">{controls}</div>
    </div>
  )
}

export function ToolbarLabel({ children }: { children: ReactNode }): JSX.Element {
  return <span className="max-sm:sr-only">{children}</span>
}

export function FieldShortcut(): JSX.Element {
  return <ShortcutKeys segments={FOCUS_FIELD_KEYS} />
}

const FOCUS_FIELD_KEYS: readonly KeySegment[] = [{ kind: 'chord', caps: [MOD, 'K'] }]

export function KeysHint({ children }: { children: ReactNode }): JSX.Element {
  return <span className="max-sm:hidden pointer-coarse:hidden">{children}</span>
}

export function ChoiceStrip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <HorizontalScroll cue aria-label={label} className="-mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </HorizontalScroll>
  )
}

export function SearchInset({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-w-0 px-4 py-4 md:px-6">{children}</div>
}

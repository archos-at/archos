import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The layout of the interaction-states preview: one family of controls per
 * block, one control per row, one state per column.
 *
 * A cell marks the state it shows with `data-force`. Nothing on the page reads
 * it: the capture script does, and forces that pseudo-class through the
 * browser's own protocol (`CSS.forcePseudoState`), so every column is the real
 * component under a real `:hover`, `:active` or `:focus-visible`, all at once.
 * Opened by hand, the page is the same grid at rest and answers the pointer.
 */

export type ForcedState = 'hover' | 'active' | 'focus'

/**
 * Wraps what a cell shows in a state. `target` narrows the forced state to
 * some descendants (one tab of a strip); without it the whole content takes it.
 */
export function Forced({
  state,
  target,
  className,
  children,
}: {
  state?: ForcedState
  target?: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div data-force={state} data-force-target={target} className={cn('flex min-h-9 items-center', className)}>
      {children}
    </div>
  )
}

export interface StateRowSpec {
  /** What the control is, as the product names it. */
  label: string
  /** Where it stands in the product, or what it is for. */
  note?: string
  /** One cell per column; `null` where the state does not exist for this control. */
  cells: readonly (ReactNode | null)[]
}

/** One family: its name, the one rule its hover follows, and its controls by state. */
export function Family({
  id,
  title,
  rule,
  columns,
  rows,
  wide = false,
}: {
  id: string
  title: string
  rule: string
  columns: readonly string[]
  rows: readonly StateRowSpec[]
  /** A family whose cells are wide (a strip of tabs, a list) gets fewer, wider columns. */
  wide?: boolean
}): JSX.Element {
  return (
    <section data-family={id} className="bg-background grid gap-4 px-8 py-7">
      <header className="grid gap-1">
        <h2 className="text-section">{title}</h2>
        <p className="text-muted-foreground max-w-[72ch] text-sm">{rule}</p>
      </header>
      <div
        className="grid items-center gap-x-6 gap-y-3"
        style={{ gridTemplateColumns: `${wide ? '180px' : '200px'} repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        <span />
        {columns.map((column) => (
          <span key={column} className="text-muted-foreground text-meta font-medium">
            {column}
          </span>
        ))}
        {rows.map((row) => (
          <StateRow key={row.label} row={row} />
        ))}
      </div>
    </section>
  )
}

function StateRow({ row }: { row: StateRowSpec }): JSX.Element {
  return (
    <>
      <div className="border-hairline grid gap-0.5 self-stretch border-t pt-3">
        <span className="text-name">{row.label}</span>
        {row.note && <span className="text-muted-foreground text-meta">{row.note}</span>}
      </div>
      {row.cells.map((cell, index) => (
        <div key={index} className="border-hairline flex min-w-0 items-center self-stretch border-t pt-3">
          {cell ?? <span className="text-muted-foreground text-meta">–</span>}
        </div>
      ))}
    </>
  )
}

/** A proposal beside what stands today: the same control drawn two or three ways, each at rest and under the pointer. */
export function VariantBlock({
  id,
  title,
  question,
  children,
}: {
  id: string
  title: string
  question: string
  children: ReactNode
}): JSX.Element {
  return (
    <section data-variant={id} className="bg-background grid gap-4 px-8 py-7">
      <header className="grid gap-1">
        <h2 className="text-section">{title}</h2>
        <p className="text-muted-foreground max-w-[72ch] text-sm">{question}</p>
      </header>
      <div className="grid gap-5">{children}</div>
    </section>
  )
}

/** One variant: its letter, its name, what speaks for it, and the drawing at rest and under the pointer. */
export function Variant({
  letter,
  name,
  verdict,
  rest,
  hover,
  recommended = false,
}: {
  letter: string
  name: string
  verdict: string
  rest: ReactNode
  hover: ReactNode
  recommended?: boolean
}): JSX.Element {
  return (
    <div className="border-hairline grid items-start gap-x-6 border-t pt-4" style={{ gridTemplateColumns: '220px minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div className="grid gap-1">
        <span className="text-name flex items-center gap-2">
          <span className="bg-desk grid size-6 place-items-center rounded-full text-xs font-semibold">{letter}</span>
          {name}
        </span>
        {recommended && <span className="text-meta font-semibold">Empfehlung</span>}
        <span className="text-muted-foreground text-meta">{verdict}</span>
      </div>
      <div className="grid gap-2">
        <span className="text-muted-foreground text-meta font-medium">Ruhe</span>
        {rest}
      </div>
      <div className="grid gap-2">
        <span className="text-muted-foreground text-meta font-medium">Zeiger</span>
        {hover}
      </div>
    </div>
  )
}

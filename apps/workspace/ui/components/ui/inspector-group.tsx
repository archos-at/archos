import type { HTMLAttributes, JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { SectionLabel } from '@/components/ui/section-label'

export function InspectorSection({
  label,
  icon,
  action,
  className,
  children,
  ...props
}: {
  label: string
  icon?: LucideIcon
  action?: ReactNode
  className?: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'children'>): JSX.Element {
  return (
    <section aria-label={label} className={cn('flex flex-col gap-2', className)} {...props}>
      <div className="flex min-h-5 items-center justify-between gap-2 px-3">
        <SectionLabel as="p" icon={icon}>
          {label}
        </SectionLabel>
        {action}
      </div>
      {children}
    </section>
  )
}

export function InspectorGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      data-slot="inspector-group"
      data-surface="sheet"
      className={cn(
        'bg-sheet shadow-sm overflow-hidden rounded-surface',
        '[&>:first-child>[data-slot=inspector-row-body]]:border-t-0',
        className
      )}
      {...props}
    />
  )
}

export function InspectorRow({
  label,
  icon: Icon,
  children,
  className,
  ...props
}: {
  label: string
  icon: LucideIcon
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>): JSX.Element {
  return (
    <div
      data-slot="inspector-row"
      className={cn('flex gap-2.5 pl-3 text-xs/5', className)}
      {...props}
    >
      {/* The glyph sits in the row's first line box, so it centres on the
          label however many lines the value wraps to. `aria-hidden`: the label
          beside it is already the accessible name. */}
      <span className="flex h-5 shrink-0 items-center self-start pt-2.5 [box-sizing:content-box]">
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
      </span>
      <div
        data-slot="inspector-row-body"
        className="border-hairline flex min-w-0 flex-1 items-start justify-between gap-3 border-t py-2.5 pr-3"
      >
        {/* The LABEL never truncates: it is the key, and „Proj…" tells the
            reader nothing. A long value wraps in its own column instead. */}
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="text-foreground min-w-0 text-right font-medium">{children}</span>
      </div>
    </div>
  )
}

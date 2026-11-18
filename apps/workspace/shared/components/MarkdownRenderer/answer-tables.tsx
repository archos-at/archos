import { cn } from '@/lib/utils'

export type TableVariant = 'plain' | 'check' | 'cases' | 'compare' | 'actions'

export const tableVariant = (value: unknown): TableVariant =>
  value === 'check' || value === 'cases' || value === 'compare' || value === 'actions' ? value : 'plain'

export const tableFrameClass = (variant: TableVariant): string =>
  cn(
    'my-4 flex flex-col gap-2 [container:answer-table/inline-size] break-inside-avoid',
    variant === 'compare' && '@max-[30rem]/compare:hidden'
  )

export const tableClass = (variant: TableVariant): string =>
  cn(
    'min-w-full caption-bottom tabular-nums [&>tbody>tr:nth-child(even):not([data-active]):not([data-conflict])]:bg-muted/30',
    (variant === 'compare' || variant === 'actions' || variant === 'cases') && '[&_td]:align-top [&_th]:align-bottom',
    variant === 'compare' &&
      '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_td:first-child]:bg-card [&_th:first-child]:bg-muted'
  )

export const headerCellClass = ({ align, recommended }: { align: string; recommended: boolean }): string =>
  cn('text-foreground px-3 py-2 text-sm font-medium', align, recommended && 'bg-success-subtle')

export const dataCellClass = ({ align, recommended }: { align?: string; recommended: boolean }): string =>
  cn('text-foreground px-3 py-2 text-sm', align, recommended && 'bg-success-subtle')

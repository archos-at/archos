'use client'

import type { JSX, ReactNode } from 'react'
import { Archive, Folder, FolderKanban, History } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { sourceBase, sourceTint } from '@/lib/ui/source-tint'
import { cn } from '@/lib/utils'
import { useCompactRow } from '../row-frame'

export function MetaPart({ children, code = false }: { children: ReactNode; code?: boolean }): JSX.Element {
  return <span className={cn('whitespace-nowrap', code && 'font-mono text-xs text-foreground/80')}>{children}</span>
}

export function MetaLine({
  parts,
  lead = [],
}: {
  parts: ReadonlyArray<ReactNode | null | undefined | false>
  lead?: ReadonlyArray<ReactNode | null | undefined | false>
}): JSX.Element {
  const present = (list: ReadonlyArray<ReactNode | null | undefined | false>): ReactNode[] => list.filter((part): part is ReactNode => Boolean(part))
  const items = [...present(lead).map((node, index) => ({ node, dot: index === 0 })), ...present(parts).map((node) => ({ node, dot: true }))]
  return (
    <span className="block min-w-0 max-w-full overflow-hidden">
      <span className="-ml-3 flex min-w-0 flex-wrap items-center gap-y-0.5">
        {items.map((item, index) => (
          <span key={index} data-meta-part className="relative inline-flex min-w-0 max-w-full items-center pl-3">
            {item.dot ? (
              <span className="absolute left-0 w-3 text-center text-muted-foreground" aria-hidden>
                ·
              </span>
            ) : null}
            {item.node}
          </span>
        ))}
      </span>
    </span>
  )
}

export function ShelfMark({
  shelf,
  label,
  wrap = false,
  quiet = false,
}: {
  shelf: 'project' | 'office_shelf'
  label: string
  wrap?: boolean
  quiet?: boolean
}): JSX.Element {
  const Icon = shelf === 'office_shelf' ? Archive : FolderKanban
  if (quiet) {
    return (
      <span className="inline-flex min-w-0 max-w-48 items-center gap-1 md:max-w-64" title={label}>
        <Icon className="size-3 shrink-0" style={{ color: sourceBase(shelf === 'office_shelf' ? 'office' : 'project') }} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex min-h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium',
        wrap ? 'max-w-full py-0.5 leading-tight' : 'max-w-40 md:max-w-56'
      )}
      style={sourceTint(shelf === 'office_shelf' ? 'office' : 'project')}
      title={wrap ? undefined : label}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className={wrap ? 'min-w-0 [overflow-wrap:anywhere]' : 'truncate'}>{label}</span>
    </span>
  )
}

export function WherePart({ children, label }: { children: ReactNode; label: string }): JSX.Element {
  const compact = useCompactRow()
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-foreground/75">
      {compact ? null : <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">{label} </span>
        {children}
      </span>
    </span>
  )
}

export function SupersededMark({ className, quiet = false }: { className?: string; quiet?: boolean }): JSX.Element {
  const tDocument = useTranslations(searchCopy, 'document')
  if (quiet) {
    return (
      <span className={cn('inline-flex h-5 items-center gap-1 text-xs text-muted-foreground', className)} title={tDocument('supersededHint')} data-testid="superseded-mark">
        <History className="size-3" aria-hidden />
        {tDocument('superseded')}
      </span>
    )
  }
  return (
    <Chip size="sm" variant="outline" className={cn('gap-1 text-muted-foreground', className)} title={tDocument('supersededHint')} data-testid="superseded-mark">
      <History aria-hidden />
      {tDocument('superseded')}
    </Chip>
  )
}

export function HitBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'outline' }): JSX.Element {
  return (
    <Chip size="sm" variant={tone}>
      {children}
    </Chip>
  )
}

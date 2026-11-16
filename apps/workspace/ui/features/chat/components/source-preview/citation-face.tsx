import type { CSSProperties, FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { Spinner } from '@/components/ui/spinner'
import { iconForTint, sourceSignalStyle } from '@/features/layout/components/SourceSignalChip'
import type { SourceTint } from '@/lib/source-kinds'
import type { CitationRef } from '../../lib/citations'
import { AuthorityTag } from '../AuthorityTag'

const chipButtonClasses = cn(
  'inline-flex h-6 max-w-full shrink-0 cursor-pointer items-center gap-1 truncate whitespace-nowrap pointer-coarse:h-auto pointer-coarse:min-h-11 pointer-coarse:whitespace-normal pointer-coarse:py-1.5 pointer-coarse:text-left',
  'rounded-control border px-2.5 text-xs font-medium outline-none',
  '[&>svg]:size-3 [&>svg]:shrink-0 hover:brightness-95 dark:hover:brightness-125 aria-busy:cursor-progress',
  PRESSABLE,
  FOCUS_RING
)

export type CitationVariant = 'chip' | 'card'

export type CitationDetail = 'full' | 'name-only'

const cardButtonClasses = cn(
  'flex w-full cursor-pointer gap-3 rounded-surface border bg-card p-3 text-left outline-none hover:bg-sheet-hover',
  'aria-busy:cursor-progress',
  PRESSABLE,
  FOCUS_RING
)

export const faceClasses = (variant: CitationVariant): string =>
  variant === 'card' ? cardButtonClasses : cn(chipButtonClasses, 'max-w-56 pointer-coarse:max-w-full')

export const inertCardClasses = 'flex w-full gap-3 rounded-surface border bg-card p-3 text-left'

export const faceStyle = (variant: CitationVariant, signal: SourceTint): CSSProperties | undefined =>
  variant === 'card' ? undefined : sourceSignalStyle(signal)

export const CitationIndex: FC<{ index?: string }> = ({ index }) =>
  !index ? null : (
    <span className="me-1 shrink-0 text-xs font-semibold tabular-nums opacity-60">{index}</span>
  )

interface CitationFaceProps {
  variant?: CitationVariant
  signal: SourceTint
  label: string
  authority?: string
  index?: string
  citation?: CitationRef
  trailing?: ReactNode
  detail?: CitationDetail
  busy?: boolean
}

const LeadingIcon: FC<{ signal: SourceTint; busy?: boolean; className?: string }> = ({
  signal,
  busy,
  className,
}) => {
  const Icon = iconForTint(signal)
  return busy ? (
    <Spinner size="xs" aria-hidden="true" className={cn('[&_svg]:size-[inherit]', className)} />
  ) : (
    <Icon aria-hidden="true" className={className} />
  )
}

export const CitationFace: FC<CitationFaceProps> = ({
  variant = 'chip',
  signal,
  label,
  authority,
  index,
  citation,
  trailing,
  detail = 'full',
  busy,
}) => {
  if (variant !== 'card') {
    return (
      <>
        <CitationIndex index={index} />
        <LeadingIcon signal={signal} busy={busy} className="size-3 shrink-0" />
        {authority && <AuthorityTag>{authority}</AuthorityTag>}
        <span className="truncate pointer-coarse:line-clamp-2 pointer-coarse:whitespace-normal pointer-coarse:break-words">{label}</span>
      </>
    )
  }

  const headline = citation?.document.title.trim() || label
  const excerpt = citation?.locus?.snippet ?? citation?.document.snippet
  const locator =
    citation?.locus?.citationKey || citation?.document.fileName || citation?.document.url

  const norm = (value: string | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const restates = (candidate: string, of: string | undefined): boolean =>
    !!candidate && norm(of).includes(norm(candidate))
  const full = detail === 'full'
  const showExcerpt = !!excerpt && !restates(excerpt, headline) && !restates(excerpt, locator)
  const showLocator = full && !!locator && !restates(locator, headline)

  return (
    <>
      {full && index && (
        <span
          className="bg-muted text-muted-foreground mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1 font-mono text-xs tabular-nums"
          aria-hidden="true"
        >
          {index}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          {full && (
            <span
              className="shrink-0"
              style={{ color: `var(--source-${signal}, var(--muted-foreground))` }}
            >
              <LeadingIcon signal={signal} busy={busy} className="size-4" />
            </span>
          )}
          {full && authority && <AuthorityTag>{authority}</AuthorityTag>}
          <span
            className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug"
            title={locator && locator !== headline ? `${headline}\n${locator}` : headline}
          >
            {headline}
          </span>
          {trailing}
        </span>
        {showExcerpt && (
          <span className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">
            {excerpt}
          </span>
        )}
        {showLocator && (
          <span className="text-muted-foreground truncate break-all font-mono text-xs">
            {locator}
          </span>
        )}
      </span>
    </>
  )
}

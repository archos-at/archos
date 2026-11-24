'use client'

import { type FC, type ReactNode } from 'react'
import { PencilLine } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import type { BoundFactState } from '@/lib/project-profile/answer-bindings'

export const ProjectValueChip: FC<{
  state: BoundFactState
  children: ReactNode
  label: string
  reason?: string
  onFill?: () => void
}> = ({ state, children, label, reason, onFill }) => {
  const t = useTranslations(commonCopy)
  const base = 'mx-0.5 inline-flex h-[1.375rem] max-w-full items-center gap-1 rounded-control border px-1.5 align-[1px] text-[0.8125rem] font-medium leading-none tabular-nums'
  if (state === 'missing') {
    const body = (
      <>
        <span className="truncate">{label}</span>
        <span className="text-warning">{t('markdown.project.missing')}</span>
        {onFill && <PencilLine aria-hidden="true" className="size-3 shrink-0 print:hidden" />}
      </>
    )
    const className = cn(base, 'bg-hatch-warning border-warning border-dashed text-foreground')
    return onFill ? (
      <button
        type="button"
        data-testid="project-value"
        data-state="missing"
        onClick={onFill}
        title={t('markdown.project.fillTitle', { label })}
        className={cn(className, 'cursor-pointer touch-target hover:border-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60')}
      >
        {body}
      </button>
    ) : (
      <span data-testid="project-value" data-state="missing" className={className}>
        {body}
      </span>
    )
  }
  return (
    <span
      data-testid="project-value"
      data-state={state}
      title={state === 'assumed' && reason ? `${label}: ${t('markdown.project.assumed')} – ${reason}` : label}
      className={cn(
        base,
        state === 'confirmed' ? 'border-transparent bg-muted text-foreground' : 'border-dashed border-border bg-card text-foreground'
      )}
    >
      <span className="truncate">{children}</span>
      {state === 'assumed' && <span className="card-meta font-normal text-muted-foreground">{t('markdown.project.assumed')}</span>}
    </span>
  )
}

export const ProjectStrip: FC<{ children: ReactNode }> = ({ children }) => {
  const t = useTranslations(commonCopy)
  return (
    <div data-testid="project-strip" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-base pb-2.5">
      <SectionLabel as="span" className="mr-1">
        {t('markdown.project.strip')}
      </SectionLabel>
      {children}
    </div>
  )
}

export const StripSeparator: FC = () => (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
)

export const CaseProjectLine: FC<{ children: ReactNode }> = ({ children }) => {
  const t = useTranslations(commonCopy)
  return (
    <p data-testid="case-project" className="card-caption flex flex-wrap items-center gap-1 text-muted-foreground">
      {t('markdown.project.yours')}
      {children}
    </p>
  )
}

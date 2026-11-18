'use client'

import { type FC, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export type StepPhase = 'none' | 'done' | 'current' | 'upcoming'

export const StepList: FC<{ ordered: boolean; children: ReactNode }> = ({ ordered, children }) => {
  const Tag = ordered ? 'ol' : 'ul'
  return <Tag className="my-4 flex list-none flex-col pl-0">{children}</Tag>
}

export const StepStation: FC<{ phase: StepPhase; number: string; last: boolean; children: ReactNode }> = ({
  phase,
  number,
  last,
  children,
}) => (
  <li className="relative grid grid-cols-[26px_minmax(0,1fr)]" data-phase={phase}>
    <span
      aria-hidden="true"
      className={cn('absolute left-[10px] top-0 w-px', last ? 'h-[15px]' : 'bottom-0', phase === 'done' ? 'bg-foreground/40' : 'bg-border')}
    />
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-[10px] top-[15px] flex size-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-mono text-[10px] tabular-nums',
        phase === 'done' && 'bg-foreground/70 text-background',
        phase === 'current' && 'bg-success text-background',
        (phase === 'none' || phase === 'upcoming') && 'border border-border bg-card text-muted-foreground'
      )}
    >
      {phase === 'done' ? <Check className="size-3.5" /> : number}
    </span>
    <div className="col-start-2 min-w-0 pb-1.5">{children}</div>
  </li>
)

export const StepLine: FC<{
  phase: StepPhase
  number?: string
  title: ReactNode
  due?: ReactNode
  open?: boolean
  expandable: boolean
}> = ({
  phase,
  number,
  title,
  due,
  open,
  expandable,
}) => {
  const t = useTranslations(commonCopy)
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-1">
        <span
          className={cn(
            'min-w-0 flex-[1_1_9rem] text-left text-answer leading-[1.5]',
            phase === 'current' ? 'font-medium text-foreground' : 'text-default',
            phase === 'done' && 'text-muted-foreground'
          )}
        >
          {number && <span className="sr-only">{t('markdown.stepAria', { step: number, label: '' }).trim()} </span>}
          {title}
        </span>
        <span className="flex min-w-0 flex-wrap items-start gap-2">
          {/* A done step's check mark and muted text are colour and shape; its word is for everyone else. */}
          {phase === 'done' && <span className="sr-only">{t('markdown.stepDone')}</span>}
          {due && <span className="card-meta mt-0.5 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{due}</span>}
          {phase === 'current' && (
            <span className="card-meta mt-0.5 rounded-full bg-success-subtle px-2 py-0.5 text-success">
              {t('markdown.stepCurrent')}
            </span>
          )}
        </span>
      </span>
      {expandable && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
            open && 'rotate-180'
          )}
        />
      )}
    </>
  )
}

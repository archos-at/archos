'use client'

import { type FC, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import type { StatusTone } from './status-marks'

export const SubsumptionFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <ol data-testid="subsumption" className="my-4 flex list-none flex-col pl-0 break-inside-avoid">
    {children}
  </ol>
)

export const SubsumptionStep: FC<{
  label: string
  part: string
  tone?: StatusTone
  statusWord?: string
  last: boolean
  children: ReactNode
}> = ({ label, part, tone, statusWord, last, children }) => (
  <li data-part={part} className="grid grid-cols-[minmax(0,1fr)] gap-1 @container">
    <div className="grid gap-1 @[34rem]:grid-cols-[8rem_minmax(0,1fr)] @[34rem]:gap-4">
      <span className="flex items-center gap-2 @[34rem]:items-start @[34rem]:pt-1">
        <SectionLabel as="span">{label}</SectionLabel>
        {tone && statusWord && (
          <Chip size="sm" variant={tone} data-testid="subsumption-status">
            {statusWord}
          </Chip>
        )}
      </span>
      <div
        className={cn(
          'min-w-0 text-answer [&_figure]:my-0 [&_p:last-child]:mb-0 [&_ul]:mb-0',
          part === 'result' && 'font-medium text-foreground'
        )}
      >
        {children}
      </div>
    </div>
    {!last && <ArrowDown aria-hidden="true" className="my-1 size-3.5 text-muted-foreground @[34rem]:ml-[8.5rem]" />}
  </li>
)

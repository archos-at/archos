'use client'

import { useState, type FC, type ReactNode } from 'react'
import { ChevronDown, CircleCheck } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export const PRINT_OPEN_CONTENT = 'data-[state=closed]:hidden print:data-[state=closed]:block'

export const disclosureRowClass = ({ current, open }: { current: boolean; open: boolean }): string =>
  cn(
    'flex w-full min-w-0 items-start gap-2 rounded-control px-2 py-1.5 text-left touch-target',
    'transition-colors duration-quick ease-out motion-reduce:transition-none',
    'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
    current ? 'bg-success-subtle' : open ? 'bg-muted/60' : 'hover:bg-muted/50'
  )

export const DisclosurePanel: FC<{ current?: boolean; children: ReactNode }> = ({ current, children }) => (
  <div
    className={cn(
      'mt-1.5 flex flex-col gap-2 rounded-surface px-3 py-2.5 text-sm [&>*:last-child]:mb-0',
      current ? 'border border-success' : 'border border-dashed bg-muted/30'
    )}
  >
    {children}
  </div>
)

export const InlineDetailsLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <SectionLabel as="p" className="mb-1">
    {children}
  </SectionLabel>
)

export const DetailsFrame: FC<{ children: ReactNode }> = ({ children }) => <div className="my-3">{children}</div>

export const DetailsSummary: FC<{ children: ReactNode; open: boolean }> = ({ children, open }) => (
  <>
    <span className="min-w-0 flex-1 text-answer font-medium leading-[1.5] text-foreground">{children}</span>
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
        open && 'rotate-180'
      )}
    />
  </>
)

export const PassedCheck: FC<{ passed: number; children: ReactNode }> = ({ passed, children }) => {
  const t = useTranslations(commonCopy)
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-4">
      <CollapsibleTrigger
        data-testid="check-passed"
        className={disclosureRowClass({ current: false, open })}
        aria-label={`${t('markdown.allPassed', { passed, total: passed })} – ${t('markdown.showRows')}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Chip size="md" variant="success">
            <CircleCheck aria-hidden="true" />
            {t('markdown.allPassed', { passed, total: passed })}
          </Chip>
          <span className="card-caption text-muted-foreground">{t('markdown.showRows')}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={PRINT_OPEN_CONTENT}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

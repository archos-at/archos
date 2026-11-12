'use client'

/**
 * What this place is for and what each step means, where the person is when
 * they wonder: three steps (upload, confirm, keep current) and the licence
 * question, each saying why it matters for the answers. Open by itself while
 * the place is empty, a disclosure once the office knows its way around.
 */

import { useState, type JSX } from 'react'
import { ChevronDown, CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { cn } from '@/lib/utils'

const STEPS = ['upload', 'confirm', 'check', 'licence'] as const

export function Guide({ defaultOpen }: { defaultOpen: boolean }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="base-knowledge-guide">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2">
          <CircleHelp className="size-4" aria-hidden />
          {t('guide.toggle')}
          <ChevronDown
            className={cn('duration-quick size-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step} className="space-y-1">
              <SectionLabel as="h3">{t(`guide.${step}.title`)}</SectionLabel>
              <p className="text-muted-foreground text-sm">{t(`guide.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

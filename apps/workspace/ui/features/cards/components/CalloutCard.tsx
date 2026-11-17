'use client'

import { useState, type FC } from 'react'
import { AlertTriangle, CalendarClock, ChevronDown, Info, Lightbulb, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { AnswerCalloutKind } from '@/lib/conversations/message-answer-meta'
import { CARD_SHELL } from './card-chrome'

interface CalloutCardProps {
  kind: AnswerCalloutKind
  text: string
  title?: string | null
  detail?: string | null
  flat?: boolean
}

interface CalloutTone {
  label: (t: Translator) => string
  icon: LucideIcon
  ink: string
  iconTone: StatCardIconTone
  wash: string
}

const AMBER_WASH = 'bg-[color-mix(in_oklch,var(--source-office)_7%,transparent)]'
const RED_WASH = 'bg-[color-mix(in_oklch,var(--signal-error)_6%,transparent)]'

const TONES: Record<AnswerCalloutKind, CalloutTone> = {
  note: {
    label: (t) => t('cards.callout.note'),
    icon: Info,
    ink: 'text-muted-foreground',
    iconTone: 'muted',
    wash: '',
  },
  warning: {
    label: (t) => t('cards.callout.warning'),
    icon: AlertTriangle,
    ink: 'text-error',
    iconTone: 'destructive',
    wash: RED_WASH,
  },
  deadline: {
    label: (t) => t('cards.callout.deadline'),
    icon: CalendarClock,
    ink: 'text-warning',
    iconTone: 'warning',
    wash: AMBER_WASH,
  },
  tip: {
    label: (t) => t('cards.callout.tip'),
    icon: Lightbulb,
    ink: 'text-muted-foreground',
    iconTone: 'muted',
    wash: '',
  },
}

export const CalloutCard: FC<CalloutCardProps> = ({ kind, text, title, detail, flat = false }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)
  const tone = TONES[kind] ?? TONES.note
  const Icon = tone.icon

  const body = (
    <div className="flex items-start gap-3">
        <StatCardIcon icon={Icon} tone={tone.iconTone} size="sm" className="mt-px" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {/* Hand-rolled rather than `SectionLabel`, because this eyebrow
                carries the kind's ink where SectionLabel hard-codes the muted
                one — so it reaches for the ramp's Eyebrow step directly. The
                tier's wash rides this pill alone, never the remark below: the
                marker marks the kind word, it never fills behind running text.
                And it shares a baseline with the title instead of sitting on a row
                of its own: that quirk is this card's identity and stays
                (answer-card-charter.md §B1 — do not "fix" it). */}
            <span className={cn('card-eyebrow rounded-surface px-1.5 py-0.5', tone.wash, tone.ink)}>{tone.label(t)}</span>
            {title && <p className="card-title text-foreground">{title}</p>}
          </div>

          <p className="card-body text-default">{text}</p>

          {detail && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger
                className={cn(
                  '-ml-1 mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 touch-target',
                  'card-caption font-medium text-muted-foreground',
                  'transition-colors duration-quick ease-out hover:text-foreground',
                  'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
                )}
              >
                {open ? t('cards.callout.less') : t('cards.callout.more')}
                <ChevronDown
                  className={cn(
                    'size-3.5',
                    'transition-transform duration-quick ease-out motion-reduce:transition-none',
                    open && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </CollapsibleTrigger>

              <CollapsibleContent>
                <p className="card-caption mt-1.5 text-muted-foreground">
                  {detail}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
  )

  if (flat) {
    return (
      <div className="max-w-[46ch] py-1 pr-1">{body}</div>
    )
  }

  return (
    <Card className={cn(CARD_SHELL, 'max-w-[46ch] gap-0 px-4 py-3.5')}>{body}</Card>
  )
}

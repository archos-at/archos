'use client'

import { useState, type FC } from 'react'
import { ChevronDown, CircleCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { AnswerMetaTakeaway } from '@/lib/conversations/message-answer-meta'
import { CARD_SHELL } from './card-chrome'

interface KeyTakeawaysCardProps {
  title?: string | null
  items: AnswerMetaTakeaway[]
  flat?: boolean
}

const SAGE_WASH = 'bg-[color-mix(in_oklch,var(--source-project)_7%,transparent)]'

const ordinal = (index: number): string => String(index + 1).padStart(2, '0')

const ROW = 'grid w-full grid-cols-[18px_minmax(0,1fr)_16px] items-start gap-2 py-2 pl-2 pr-1.5 text-left'

const RowBody: FC<{ index: number; text: string }> = ({ index, text }) => {
  const isFigure = index === 0
  return (
    <>
      <span
        className={cn(
          'card-meta mt-1 font-mono',
          isFigure ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {ordinal(index)}
      </span>
      <span
        className={cn(
          'min-w-0 text-pretty text-foreground',
          isFigure ? 'card-figure-16' : 'card-body',
        )}
      >
        {text}
      </span>
    </>
  )
}

const TakeawayRow: FC<{ item: AnswerMetaTakeaway; index: number }> = ({ item, index }) => {
  const [open, setOpen] = useState(false)

  if (!item.detail) {
    return (
      <div className={ROW}>
        <RowBody index={index} text={item.text} />
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          ROW,
          'group pointer-coarse:py-3 rounded-control transition-colors duration-quick ease-out hover:bg-hover',
          'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
        )}
      >
        <RowBody index={index} text={item.text} />
        <ChevronDown
          className={cn(
            'mt-1 size-4 text-muted-foreground',
            'transition-transform duration-quick ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {/* Indented past the takeaway's own text column and set in the muted
            caption, so the detail reads as belonging to the row above rather
            than as a fifth takeaway. */}
        <p className="card-caption mb-2 ml-9 max-w-prose pl-3 text-muted-foreground">
          {item.detail}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const KeyTakeawaysCard: FC<KeyTakeawaysCardProps> = ({ title, items, flat = false }) => {
  const t = useTranslations(chatCopy)
  const takeaways = items.filter((item) => Boolean(item?.text))

  if (takeaways.length === 0) return null

  const body = (
    <>
      {/* Hand-rolled rather than `SectionLabel`, for the same reason CalloutCard
          names in its own body: this eyebrow carries the distillation ink (dark
          green) where SectionLabel hard-codes the muted one — and the check
          glyph is the icon half of the hue + label + icon triple. The
          sage wash rides this pill alone, never the rows below: the marker
          marks the block's eyebrow, it never fills behind the running text. */}
      <span className={cn('card-eyebrow inline-flex w-fit items-center gap-1.5 rounded-control px-1.5 py-0.5 text-success', SAGE_WASH)}>
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        {t('cards.keyTakeaways.eyebrow')}
      </span>
      {title && <p className="card-title text-foreground">{title}</p>}

      {/* No rules between rows and none down the gutter: the rank is
          carried by the ordinals, not by a box per takeaway. */}
      <ol className="mt-0.5 flex flex-col">
        {takeaways.map((item, index) => (
          <li key={`${item.text}-${index}`}>
            <TakeawayRow item={item} index={index} />
          </li>
        ))}
      </ol>
    </>
  )

  if (flat) {
    return (
      <div className="flex flex-col gap-2 py-1">
        {body}
      </div>
    )
  }

  return <Card className={cn(CARD_SHELL, 'gap-2 p-5')}>{body}</Card>
}

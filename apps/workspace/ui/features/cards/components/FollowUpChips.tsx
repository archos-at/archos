'use client'

import { type FC } from 'react'
import { CornerDownRight, type LucideIcon } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { StoredFollowUp } from '@/lib/conversations/message-stages'

export interface FollowUpAction {
  key: string
  label: string
  prefill: string
  icon?: LucideIcon
}

interface FollowUpChipsProps {
  title?: string | null
  items: StoredFollowUp[]
  actions?: FollowUpAction[]
  className?: string
}

const CHIP = cn(
  'group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-control px-[13px] py-1',
  'max-sm:min-w-[12rem] bg-card text-foreground/85 shadow-xs card-caption font-medium',
  'transition-colors duration-quick ease-out motion-reduce:transition-none',
  'hover:bg-sheet-hover hover:text-foreground',
  'focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
  'pointer-coarse:min-h-11',
)

export const usableFollowUps = (items: StoredFollowUp[]): StoredFollowUp[] =>
  items.filter((item) => Boolean(item?.question))

export const FollowUpChips: FC<FollowUpChipsProps> = ({
  title,
  items,
  actions = [],
  className,
}) => {
  const t = useTranslations(chatCopy)
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)
  const questions = usableFollowUps(items)

  if (questions.length === 0 && actions.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <SectionLabel>{t('cards.followUps.eyebrow')}</SectionLabel>
      {title && <p className="card-title text-foreground">{title}</p>}

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('cards.followUps.groupAria')}
      >
        {questions.map((item, index) => (
          <button
            key={`${item.question}-${index}`}
            type="button"
            title={item.hint ? `${item.question} — ${item.hint}` : item.question}
            onClick={() => setComposerPrefill(item.question)}
            className={CHIP}
          >
            <CornerDownRight
              className="text-subtle group-hover:text-foreground size-3.5 shrink-0 transition-colors duration-quick ease-out motion-reduce:transition-none"
              aria-hidden="true"
            />
            <span className="max-sm:text-left sm:truncate">{item.question}</span>
          </button>
        ))}
        {actions.map((action) => {
          const Icon = action.icon ?? CornerDownRight
          return (
            <button
              key={action.key}
              type="button"
              data-testid={`follow-up-action-${action.key}`}
              onClick={() => setComposerPrefill(action.prefill)}
              className={CHIP}
            >
              <Icon
                className="text-subtle group-hover:text-foreground size-3.5 shrink-0 transition-colors duration-quick ease-out motion-reduce:transition-none"
                aria-hidden="true"
              />
              <span className="max-sm:text-left sm:truncate">{action.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import type { JSX, ReactNode } from 'react'
import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { MAIL_THREAD_FOLLOW_DEFAULT_DAYS } from '@/lib/mail-thread/mail-thread-wire'
import { cn } from '@/lib/utils'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

export interface FollowSwitchProps {
  on: boolean
  onChange: (on: boolean) => void
  /** The follow's end, said beside „An“ once it runs. */
  until?: string | null
  disabled?: boolean
  /** What stands under the explanation, such as the limit of a renewal. */
  children?: ReactNode
  className?: string
  testId?: string
}

/** Filing a Verlauf's replies without a click, as one switch with its state in words, in the same words wherever it is set. */
export function FollowSwitch({ on, onChange, until = null, disabled = false, children, className, testId = 'follow-switch' }: FollowSwitchProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  const id = useId()
  return (
    <div className={cn('flex items-start gap-3', className)} data-testid={testId} data-on={on}>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-state ${id}-explain`}
        className="mt-px"
        data-testid={`${testId}-control`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-foreground text-sm font-medium leading-snug [overflow-wrap:anywhere]">
          {t('follow.label')}
        </label>
        <p id={`${id}-state`} className="text-foreground text-xs font-medium tabular-nums" data-testid={`${testId}-state`}>
          {on ? (until ? t('follow.onUntil', { date: until }) : t('follow.on')) : t('follow.off')}
        </p>
        <p id={`${id}-explain`} className="text-muted-foreground mt-0.5 text-xs leading-snug">
          {t('follow.explain', { days: MAIL_THREAD_FOLLOW_DEFAULT_DAYS })}
        </p>
        {children}
      </div>
    </div>
  )
}

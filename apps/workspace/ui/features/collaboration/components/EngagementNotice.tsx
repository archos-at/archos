'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { AtSign } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

import { motion, motionQuick, useMotionToken } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { ConversationEngagement } from '@/lib/db/schema/conversations'
import { cn } from '@/lib/utils'

export interface EngagementNoticeProps {
  mode: ConversationEngagement
  suggestion?: ConversationEngagement | null
  onChange: (mode: ConversationEngagement) => Promise<boolean> | boolean
  canChange?: boolean
  className?: string
}

export function EngagementNotice({
  mode,
  suggestion = null,
  onChange,
  canChange = true,
  className,
}: EngagementNoticeProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const enter = useMotionToken(motionQuick)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const offering = mode === 'ask' ? suggestion : 'ask'
  if (mode === 'ask' && (!suggestion || !canChange)) return null

  const change = async (next: ConversationEngagement): Promise<void> => {
    setSaving(true)
    setFailed(false)
    try {
      if ((await onChange(next)) === false) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enter}
      data-testid="engagement-notice"
      data-engagement={mode}
      className={cn('text-muted-foreground flex items-start gap-2 text-xs', className)}
    >
      <AtSign className="mt-[0.15rem] size-3.5 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {mode === 'mention' ? (
        <>
          <span className="text-foreground/80 font-medium">
            {t('mentions.engagement.mentionLabel')}
          </span>
          <span className="min-w-0">{t('mentions.engagement.mentionHint')}</span>
        </>
      ) : (
        <span className="min-w-0">{t('mentions.engagement.offerHint')}</span>
      )}

      {canChange && offering && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 px-1.5 text-xs font-medium',
            'text-foreground/90 underline decoration-dotted decoration-from-font underline-offset-[3px]',
            'transition-colors duration-snap ease-out hover:decoration-solid hover:text-foreground',
            'motion-reduce:transition-none',
          )}
          disabled={saving}
          onClick={() => void change(offering)}
        >
          {saving && <Spinner size="xs" aria-hidden className="mr-1" />}
          {offering === 'ask'
            ? t('mentions.engagement.switchToAsk')
            : t('mentions.engagement.switchToMention')}
        </Button>
      )}

      {failed && (
        <span
          role="alert"
          className="text-error animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none"
        >
          {t('mentions.engagement.failed')}
        </span>
      )}
      </span>
    </motion.div>
  )
}

'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { motion, springSnap, useMotionToken } from '@/components/motion'
import { SHELL_COUNT } from '@/components/shell/shell-count'
import { CountPill } from '@/components/ui/count-pill'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'

export interface InboxBadgeProps {
  pending: number
  className?: string
  tone?: 'attention' | 'muted'
}

export function InboxBadge({ pending, className, tone = 'attention' }: InboxBadgeProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const settle = useMotionToken(springSnap)
  const shown = Number.isFinite(pending) && pending > 0 ? Math.floor(pending) : 0
  const [seen, setSeen] = useState(shown)
  const [rises, setRises] = useState(0)
  if (shown !== seen) {
    setSeen(shown)
    if (shown > seen) setRises(rises + 1)
  }

  if (shown === 0) return null

  const count = shown
  const label = count === 1 ? t('inbox.badgeAriaOne') : t('inbox.badgeAria', { count })

  return (
    <motion.span
      key={rises}
      className={className ? `inline-flex ${className}` : 'inline-flex'}
      initial={rises > 0 ? { scale: 0.7 } : false}
      animate={{ scale: 1 }}
      transition={settle}
    >
      <CountPill
        tone={tone}
        className={tone === 'muted' ? SHELL_COUNT : undefined}
        role="status"
        aria-label={label}
        data-testid="inbox-badge"
        data-pending={count}
        count={count}
      />
    </motion.span>
  )
}

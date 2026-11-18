'use client'

import type { JSX } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { isAgentKind } from '@/lib/agent-kind'
import { PRODUCT_NAME } from '@/lib/brand'
import { firstWords, type LiveMark } from '../../lib/canvas-activity'

export function ThreadGlance({ mark }: { mark: LiveMark | 'gone' | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (!mark || mark === 'gone' || mark.replyCount === 0) return null
  const last = mark.lastReply
  const name = last
    ? isAgentKind(last.authorKind)
      ? PRODUCT_NAME
      : (last.authorName ?? t('cards.canvasActivity.thread.someone'))
    : null
  return (
    <p className="card-caption text-muted-foreground" data-testid="canvas-activity-thread">
      {t('cards.canvasActivity.thread.count', { count: mark.replyCount })}
      {last && name && ` · ${t('cards.canvasActivity.thread.last', { name, excerpt: firstWords(last.body) })}`}
    </p>
  )
}

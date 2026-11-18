'use client'

import type { JSX } from 'react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AgentWakeTrigger, MarkMention } from '@/lib/annotations/types'
import { isAgentKind, type AgentKind } from '@/lib/agent-kind'
import { useAgentByline } from '../agent-attribution'
import { MarkBody } from '../mark-body'

export function Message({
  authorKind,
  name,
  userId,
  at,
  body,
  mentions,
  viewerId,
  proposal,
  woken,
  editedAt,
  actions,
}: {
  authorKind: 'person' | AgentKind
  name: string | null
  userId: string
  at: string
  body: string
  mentions?: readonly MarkMention[]
  viewerId: string | null
  proposal?: boolean
  woken?: { trigger: AgentWakeTrigger; number: number } | null
  editedAt?: string | null
  actions?: React.ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const byline = useAgentByline()
  const wokenTitle = woken
    ? name
      ? t('review.attribution.wokenTitle', { name, number: woken.number })
      : t('review.attribution.wokenTitleNameless', { number: woken.number })
    : undefined
  return (
    <div className="flex gap-2.5">
      {isAgentKind(authorKind) ? (
        <AgentGlyph />
      ) : (
        <PersonAvatar
          size="sm"
          className="size-6 text-[10px]"
          person={{ userId, name: name ?? t('review.someone'), profilePictureUrl: null }}
        />
      )}
      <div className="min-w-0 flex-1">
        {/* The name gives way, the time never wraps: „2 hours ago" on two lines reads as two facts. */}
        <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span
            className="text-foreground min-w-0 truncate font-medium"
            data-testid={isAgentKind(authorKind) ? 'thread-byline' : undefined}
            title={isAgentKind(authorKind) ? byline(name, { proposal }) : (name ?? undefined)}
          >
            {isAgentKind(authorKind) ? byline(name, { proposal }) : (name ?? t('review.someone'))}
          </span>
          <TimeAgo date={at} locale={locale} className="text-muted-foreground shrink-0 whitespace-nowrap" />
          {editedAt && (
            <span
              className="text-muted-foreground shrink-0 whitespace-nowrap"
              title={new Date(editedAt).toLocaleString(locale)}
              data-testid="thread-edited"
            >
              · {t('review.edited')}
            </span>
          )}
          {actions && <span className="-my-1 ml-auto shrink-0">{actions}</span>}
        </p>
        {woken && (
          <p className="text-muted-foreground text-[11px] leading-4" title={wokenTitle} data-testid="thread-woken">
            {t(`review.attribution.woken.${woken.trigger}`)}
          </p>
        )}
        <p className="text-foreground mt-0.5 text-[13px] leading-5 break-words whitespace-pre-wrap">
          <MarkBody text={body} mentions={mentions} viewerId={viewerId} />
        </p>
      </div>
    </div>
  )
}

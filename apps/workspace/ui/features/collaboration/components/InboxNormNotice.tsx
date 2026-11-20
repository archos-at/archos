'use client'

import type { JSX, MouseEvent } from 'react'
import Link from 'next/link'
import { Upload } from 'lucide-react'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { InboxItemView } from '@/lib/inbox/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NormNotice } from '../lib/inbox-norm-notice'
import { InboxNormSuggestionDecision, type InboxNormDecisionClient } from './InboxNormSuggestionDecision'

export function InboxNormLines({
  notice,
  body,
  className,
}: {
  notice: NormNotice
  body: string | null
  className?: string
}): JSX.Element | null {
  if (!notice.names && !body) return null
  return (
    <span className={cn('flex min-w-0 flex-col gap-0.5', className)} data-testid="inbox-norm-lines">
      {notice.names && (
        <span className="line-clamp-2 text-sm leading-snug text-foreground" data-testid="inbox-norm-names">
          {notice.names}
        </span>
      )}
      {body && <span className="line-clamp-3 text-xs leading-snug text-muted-foreground">{body}</span>}
    </span>
  )
}

export function InboxNormActions({
  item,
  notice,
  onFollow,
  decisionClient,
  className,
}: {
  item: InboxItemView
  notice: NormNotice
  onFollow?: (event: MouseEvent<HTMLAnchorElement>) => void
  decisionClient?: InboxNormDecisionClient
  className?: string
}): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  if (notice.decide && item.anchorId) {
    return (
      <div className={className}>
        <InboxNormSuggestionDecision proposalId={item.anchorId} client={decisionClient} />
      </div>
    )
  }
  if (notice.links.length === 0) return null
  return (
    <div className={cn('relative z-10 mt-2 flex flex-wrap items-center gap-1.5', className)} data-testid="inbox-norm-actions">
      {notice.links.map((link) => (
        <Button key={link.id} asChild size="sm" variant={link.primary ? 'default' : 'secondary'} className="h-7 text-xs">
          <Link
            href={link.href}
            onClick={onFollow}
            aria-label={link.id === 'viewEdition' && item.subject ? t('inbox.normNotice.viewEditionLabel', { subject: item.subject }) : undefined}
            data-testid={`inbox-norm-${link.id}`}
          >
            {link.id === 'uploadEdition' && <Upload aria-hidden />}
            {t(`inbox.normNotice.${link.id}`)}
          </Link>
        </Button>
      ))}
    </div>
  )
}

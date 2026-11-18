'use client'

import type { JSX } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslations, type Translator } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import {
  documentBadgeState,
  type DocumentBadgeState,
  type DocumentVersionBadgeSubject,
} from '../lib/document-lifecycle'

const BADGE_VARIANT: Record<DocumentBadgeState, 'secondary' | 'outline'> = {
  draft: 'secondary',
  in_review: 'secondary',
  changes_requested: 'secondary',
  approved: 'secondary',
  published: 'secondary',
  rejected: 'outline',
  superseded: 'outline',
  archived: 'outline',
}

const SETTLED: ReadonlySet<DocumentBadgeState> = new Set(['approved', 'published'])

const LABEL_KEY: Record<DocumentBadgeState, string> = {
  draft: 'lifecycle.states.draft',
  in_review: 'lifecycle.states.inReview',
  changes_requested: 'lifecycle.states.changesRequested',
  approved: 'lifecycle.states.approved',
  published: 'lifecycle.states.published',
  rejected: 'lifecycle.states.rejected',
  superseded: 'lifecycle.states.superseded',
  archived: 'lifecycle.states.archived',
}

export function documentVersionStateLabel(state: DocumentBadgeState, t: Translator): string {
  return t(LABEL_KEY[state])
}

export interface DocumentVersionStateBadgeProps extends DocumentVersionBadgeSubject {
  className?: string
  always?: boolean
  testId?: string
}

export function DocumentVersionStateBadge({
  className,
  always = false,
  testId = 'document-version-badge',
  ...subject
}: DocumentVersionStateBadgeProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const state = always
    ? (subject.lifecycle === 'archived' ? 'archived' : (subject.versionState ?? null))
    : documentBadgeState(subject)
  if (!state) return null

  return (
    <Badge
      variant={BADGE_VARIANT[state]}
      className={cn('shrink-0 font-medium', SETTLED.has(state) && 'text-muted-foreground border-transparent bg-transparent px-0 font-normal', className)}
      data-testid={testId}
      data-state={state}
      title={t('lifecycle.badgeTitle', { state: documentVersionStateLabel(state, t) })}
    >
      {documentVersionStateLabel(state, t)}
    </Badge>
  )
}

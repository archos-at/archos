'use client'

import type { JSX } from 'react'
import { Building2, Lock, Share2, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { ResourceAccessEntry, ResourceVisibility } from '@/lib/sharing/types'
import { cn } from '@/lib/utils'

export function namedAudienceCount(
  entries: readonly ResourceAccessEntry[],
  viewerUserId?: string | null,
): number {
  return entries.filter(
    (entry) =>
      entry.person.userId !== viewerUserId &&
      (entry.reason === 'grant' || entry.reason === 'creator'),
  ).length
}

export interface AccessChipProps {
  visibility: ResourceVisibility
  sharedWith?: number
  size?: 'sm' | 'md'
  className?: string
}

const ICONS: Record<'private' | 'shared' | 'project' | 'organization', LucideIcon> = {
  private: Lock,
  shared: Share2,
  project: Users,
  organization: Building2,
}

export function AccessChip({
  visibility,
  sharedWith = 0,
  size = 'sm',
  className,
}: AccessChipProps): JSX.Element {
  const t = useTranslations(collaborationCopy)

  const count = Number.isFinite(sharedWith) ? Math.max(0, Math.floor(sharedWith)) : 0
  const state =
    visibility === 'private' ? (count > 0 ? 'shared' : 'private') : visibility
  const Icon = ICONS[state]

  const label =
    state === 'shared'
      ? count === 1
        ? t('sharing.chip.sharedOne')
        : t('sharing.chip.sharedMany', { count })
      : t(`sharing.chip.${state}`)

  return (
    <Chip
      role="img"
      aria-label={t('sharing.chip.ariaLabel', { label })}
      data-testid="access-chip"
      data-visibility={visibility}
      data-state={state}
      variant={state === 'private' ? 'muted' : 'outline'}
      size={size}
      className={cn('font-medium', className)}
    >
      <Icon aria-hidden />
      {label}
    </Chip>
  )
}

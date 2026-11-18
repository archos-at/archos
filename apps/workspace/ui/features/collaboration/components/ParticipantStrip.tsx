'use client'

import type { JSX } from 'react'
import { AvatarStack } from '@/components/ui/avatar-stack'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { ResourceAccessEntry, ResourceRole } from '@/lib/sharing/types'
import { cn } from '@/lib/utils'

const ROLE_RANK: Record<ResourceRole, number> = { owner: 0, collaborator: 1, viewer: 2 }

const DEFAULT_MAX_VISIBLE = 4

export function sortByRoleThenName(entries: readonly ResourceAccessEntry[]): ResourceAccessEntry[] {
  return [...entries].sort(
    (a, b) =>
      ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.person.name.localeCompare(b.person.name),
  )
}

export interface ParticipantStripProps {
  entries: readonly ResourceAccessEntry[]
  currentUserId?: string | null
  maxVisible?: number
  onOpen?: () => void
  className?: string
}

export function ParticipantStrip({
  entries,
  currentUserId = null,
  maxVisible = DEFAULT_MAX_VISIBLE,
  onOpen,
  className,
}: ParticipantStripProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)

  if (entries.length <= 1) return null

  const ordered = sortByRoleThenName(entries)

  const stack = (
    <AvatarStack
      people={ordered.map((entry) => entry.person)}
      max={maxVisible}
      size="sm"
      renderPerson={(person, face, index) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative inline-flex">{face}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="block font-medium">
              {person.userId === currentUserId
                ? `${person.name} (${t('sharing.overview.you')})`
                : person.name}
            </span>
            <span className="block text-background/70">
              {t(`sharing.roles.${ordered[index].role}`)}
            </span>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )

  if (!onOpen) {
    return (
      <span
        role="img"
        aria-label={t('thread.participantsAria')}
        data-testid="participant-strip"
        className={cn('inline-flex shrink-0 items-center', className)}
      >
        {stack}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('thread.participantsAria')}
      title={t('sharing.overview.openLabel')}
      data-testid="participant-strip"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full p-0.5 outline-none touch-target',
        'transition-colors duration-quick ease-out',
        'hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      {stack}
    </button>
  )
}

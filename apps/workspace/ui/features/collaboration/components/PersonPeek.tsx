'use client'

import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'

import { PersonAvatar } from '@/components/ui/avatar-stack'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { cn } from '@/lib/utils'

export interface PersonPeekPerson {
  userId: string
  name: string
  email?: string | null
  profilePictureUrl?: string | null
}

export interface PersonPeekProps {
  person: PersonPeekPerson
  isAgent?: boolean
  isYou?: boolean
  isParticipant?: boolean
  className?: string
}

export function PersonPeek({
  person,
  isAgent = false,
  isYou = false,
  isParticipant,
  className,
}: PersonPeekProps): JSX.Element {
  const t = useTranslations(collaborationCopy)

  return (
    <div data-testid="person-peek" className={cn('flex items-start gap-3', className)}>
      {isAgent ? (
        <span
          aria-hidden
          className="border-border bg-muted text-foreground/80 inline-flex size-9 shrink-0 items-center justify-center rounded-full border"
        >
          <Sparkles className="size-4" />
        </span>
      ) : (
        <PersonAvatar person={person} size="md" />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium">
          {person.name}
          {isYou && (
            <span className="text-muted-foreground font-normal">
              {' '}
              ({t('sharing.overview.you')})
            </span>
          )}
        </p>

        {/* The assistant has no inbox; saying "was asked" about it would be a
            category error. Its second line is what it IS. */}
        {isAgent ? (
          <p className="text-muted-foreground text-xs">{t('mentions.peek.agentRole')}</p>
        ) : (
          person.email && <p className="text-muted-foreground truncate text-xs">{person.email}</p>
        )}

        {/* The thread-relevant fact. Only stated when known, and only for humans:
            "not in this chat yet" is the difference between a tag that reaches
            someone and a tag that quietly does nothing. */}
        {!isAgent && isParticipant !== undefined && (
          <p
            data-testid="person-peek-access"
            className={cn(
              'mt-1.5 text-xs',
              isParticipant ? 'text-muted-foreground' : 'text-warning'
            )}
          >
            {isParticipant
              ? t('mentions.peek.inConversation')
              : t('mentions.peek.notInConversation')}
          </p>
        )}
      </div>
    </div>
  )
}

'use client'

import type { JSX } from 'react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { identityInk } from '@/components/ui/avatar-identity'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { PRODUCT_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { useRoomCompany } from '../../../hooks/use-room-company'

export function Presence({
  review,
  following = null,
  onFollow,
}: {
  review: ReviewState
  following?: string | null
  onFollow?: (peerId: string | null) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const tPresence = useTranslations(presenceCopy)
  const { people: others, piloti: agent } = useRoomCompany(review.room)
  const forName = agent?.forName
  const onBehalf = forName ? tPresence('piloti.onBehalfOf', { name: forName }) : null
  if (others.length === 0 && !agent) return null
  if (!onFollow) {
    return (
      <span aria-hidden className="flex items-center -space-x-1" data-testid="review-presence">
        {agent && (
          <span className="ring-background rounded-full ring-2">
            <AgentGlyph size="md" working={agent.working} label={onBehalf ?? PRODUCT_NAME} />
          </span>
        )}
        {others.map((person) => (
          <PersonAvatar
            key={person.userId}
            size="sm"
            className="ring-background size-7 text-[10px] ring-2"
            person={{ userId: person.userId, name: person.name, profilePictureUrl: null }}
          />
        ))}
      </span>
    )
  }
  return (
    <div className="flex items-center -space-x-1" data-testid="review-presence">
      {agent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-testid="review-presence-agent" className="ring-background rounded-full ring-2">
              <AgentGlyph size="md" working={agent.working} label={onBehalf ?? PRODUCT_NAME} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {onBehalf ? (
              <>
                <span className="block">{onBehalf}</span>
                {agent.label && <span className="block">{agent.label}</span>}
              </>
            ) : (
              agent.label || t('review.agentWorking')
            )}
          </TooltipContent>
        </Tooltip>
      )}
      {others.map((person) => {
        const on = following === person.peerId
        return (
          <Tooltip key={person.userId}>
            <TooltipTrigger asChild>
              <button data-attr="review-peer"
                type="button"
                data-testid="review-peer"
                aria-pressed={on}
                aria-label={on ? t('review.unfollow', { name: person.name }) : t('review.follow', { name: person.name })}
                onClick={() => onFollow(on ? null : person.peerId)}
                className="relative rounded-full outline-none focus-visible:ring-2"
              >
                <PersonAvatar
                  size="sm"
                  className="ring-background size-7 text-[10px] ring-2"
                  person={{ userId: person.userId, name: person.name, profilePictureUrl: null }}
                />
                <span
                  aria-hidden
                  className={cn('absolute -inset-[3px] rounded-full border-2', on ? 'opacity-100' : 'opacity-0')}
                  style={{ borderColor: identityInk(person.userId) }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="block">
                {on ? t('review.unfollow', { name: person.name }) : t('review.follow', { name: person.name })}
              </span>
              {person.page && <span className="block">{t('review.onPage', { name: person.name, page: person.page })}</span>}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

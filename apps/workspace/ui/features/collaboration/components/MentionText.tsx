'use client'

import type { JSX } from 'react'
import { Fragment } from 'react'

import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { motion, springPress } from '@/components/motion'
import { cn } from '@/lib/utils'
import { useMentionPerson } from '../context/mention-people'
import { splitMentionSegments, type DraftMention } from '@/lib/mentions/mention-text'
import { PersonPeek } from './PersonPeek'

export interface MentionTextProps {
  content: string
  mentions?: readonly DraftMention[]
  currentUserId?: string | null
  meTone?: 'warning' | 'ink'
  className?: string
}

const pillClasses = (isMe: boolean, isAgent: boolean, interactive: boolean, meTone: 'warning' | 'ink' = 'warning'): string =>
  cn(
    'inline-flex items-baseline rounded-md px-[3px] py-px align-baseline text-[0.9375em] font-medium',
    'pointer-coarse:py-1',
    isMe
      ? meTone === 'ink'
        ? 'bg-desk text-foreground font-semibold'
        : 'bg-warning-subtle text-warning'
      : isAgent
        ? 'bg-foreground/[0.08] text-foreground/85'
        : 'bg-muted text-foreground/80',
    interactive &&
      cn(
        'cursor-pointer transition-[filter,box-shadow] duration-quick ease-out hover:brightness-95 dark:hover:brightness-125',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      )
  )

function MentionPill({
  targetId,
  text,
  label,
  isMe,
  meTone,
}: {
  targetId: string
  text: string
  label: string
  isMe: boolean
  meTone?: 'warning' | 'ink'
}): JSX.Element {
  const peek = useHoverPopover()
  const resolved = useMentionPerson(targetId)
  const isAgent = targetId === AGENT_MENTION_ID

  if (!resolved) {
    return (
      <span
        data-testid="mention-chip"
        data-mention-target={targetId}
        data-mention-me={isMe ? 'true' : 'false'}
        className={pillClasses(isMe, isAgent, false, meTone)}
        aria-label={label}
      >
        {text}
      </span>
    )
  }

  return (
    <>
      {/* A press gives way slightly — `springPress` is the kit's vocabulary for
            anything the user physically touches, and it is the only motion a pill
            gets. Nothing on mount: these render inline in prose, and a message
            whose mentions animate in draws the eye away from the sentence. Scale
            only, no vertical move, so a pill cannot nudge the line it sits on. */}
      <motion.button
        type="button"
        data-testid="mention-chip"
        data-mention-target={targetId}
        data-mention-me={isMe ? 'true' : 'false'}
        data-mention-interactive="true"
        whileTap={{ scale: 0.96 }}
        transition={springPress}
        {...peek.triggerProps}
        className={pillClasses(isMe, resolved.isAgent, true, meTone)}
        aria-label={label}
      >
        {text}
      </motion.button>
      {/* Narrower than the citation peek: a person is four short lines, and a
          panel sized for a source snippet would be mostly empty. */}
      <HoverPeekPanel peek={peek} className="w-64 p-3">
        <PersonPeek
          person={resolved.person}
          isAgent={resolved.isAgent}
          isYou={resolved.isYou}
          isParticipant={resolved.isParticipant}
        />
      </HoverPeekPanel>
    </>
  )
}

export function MentionText({
  content,
  mentions,
  currentUserId,
  meTone,
  className,
}: MentionTextProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const segments = splitMentionSegments(content, mentions ?? [])

  return (
    <span className={cn('whitespace-pre-wrap', className)} data-testid="mention-text">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <Fragment key={index}>{segment.text}</Fragment>

        const isMe = Boolean(currentUserId) && segment.targetId === currentUserId

        return (
          <MentionPill
            key={index}
            targetId={segment.targetId}
            text={segment.text}
            isMe={isMe}
            meTone={meTone}
            label={
              isMe
                ? t('thread.mentionedYouAria')
                : t('thread.mentionAria', { name: segment.display })
            }
          />
        )
      })}
    </span>
  )
}

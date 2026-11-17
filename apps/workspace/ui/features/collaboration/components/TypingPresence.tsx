'use client'

import type { FC } from 'react'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { WorkingDots } from '@/components/ui/working-dots'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { DirectoryPerson } from '@/lib/sharing/types'
import { cn } from '@/lib/utils'

export interface TypingPresenceProps {
  typists: DirectoryPerson[]
  className?: string
}

const MAX_NAMED = 2

export const TypingPresence: FC<TypingPresenceProps> = ({ typists, className }) => {
  const t = useTranslations(collaborationCopy)
  if (typists.length === 0) return null

  const named = typists.slice(0, MAX_NAMED)
  const overflow = typists.length - named.length
  const names =
    named.length === 2 && overflow === 0
      ? t('thread.typingNamePair', { first: named[0].name, second: named[1].name })
      : named.map((person) => person.name).join(t('thread.typingNameSeparator'))
  const label =
    overflow > 0
      ? t(overflow === 1 ? 'thread.typingManyOne' : 'thread.typingMany', { names, count: overflow })
      : t(named.length > 1 ? 'thread.typingPair' : 'thread.typing', { names })

  return (
    <div
      className={cn('flex w-fit items-center gap-2 py-1', className)}
      data-testid="typing-presence"
    >
      <div className="flex -space-x-1.5">
        {named.map((person) => (
          <PersonAvatar key={person.userId} person={person} size="sm" />
        ))}
      </div>
      {/* aria-hidden: the live region below is the single announcement. Without
      this the identical sentence sits twice in the accessibility tree and a screen
      reader reads the names, then reads them again. */}
      <span className="text-muted-foreground text-xs" aria-hidden="true">
        {label}
      </span>
      {/* The house wave (`animate-typing-dot` on --motion-ambient and
          --ease-cycle, its stagger inside the utility), not Tailwind's
          `animate-bounce`, whose ease-in keyframes and inline timings were a
          second dialect of the same three dots. */}
      <WorkingDots className="text-muted-foreground" />
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
    </div>
  )
}

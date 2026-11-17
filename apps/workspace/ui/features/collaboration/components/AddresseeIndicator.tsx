'use client'

import type { JSX } from 'react'
import { AtSign, Users } from 'lucide-react'

import { AvatarStack, type AvatarStackPerson } from '@/components/ui/avatar-stack'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { cn } from '@/lib/utils'
import type { DraftMention } from '@/lib/mentions/mention-text'

export interface AddresseeIndicatorProps {
  mentions: readonly DraftMention[]
  awaitingHuman: boolean
  onMentionSomeone?: () => void
  className?: string
}

export type AddresseeMode = 'agent' | 'people' | 'thread'

export function AddresseeIndicator({
  mentions,
  awaitingHuman,
  onMentionSomeone,
  className,
}: AddresseeIndicatorProps): JSX.Element {
  const t = useTranslations(collaborationCopy)

  const humans = mentions.filter((mention) => mention.targetId !== AGENT_MENTION_ID)
  const agentTagged = mentions.some((mention) => mention.targetId === AGENT_MENTION_ID)
  const agentName = t('mentions.picker.agentName')

  const mode: AddresseeMode =
    humans.length > 0 ? 'people' : agentTagged || !awaitingHuman ? 'agent' : 'thread'

  const names = [...humans.map((mention) => mention.display), ...(agentTagged ? [agentName] : [])]

  const label =
    mode === 'agent'
      ? null
      : mode === 'thread'
        ? t('mentions.addressee.toThread')
        : names.length === 1
          ? t('mentions.addressee.toPerson', { name: names[0] })
          : t('mentions.addressee.toPeople', { names: names.join(', ') })

  const people: AvatarStackPerson[] = humans.map((mention) => ({
    userId: mention.targetId,
    name: mention.display,
  }))

  return (
    <p
      data-testid="composer-addressee"
      data-mode={mode}
      role={label ? 'status' : undefined}
      aria-label={label ? t('mentions.addressee.ariaLabel', { label }) : undefined}
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground',
        label ? 'order-last basis-full pt-0.5' : 'order-1',
        className,
      )}
    >
      {people.length > 0 && <AvatarStack people={people} size="sm" max={3} />}
      {mode === 'thread' && <Users className="size-3.5 shrink-0 opacity-70" aria-hidden />}
      {/* No agent glyph. The spark used to lead the agent — alone, and then at
          the end of a list of people — and the composer no longer carries it
          anywhere: the names say who is addressed, and the agent is one of them. */}
      {label && <span className="min-w-0 truncate">{label}</span>}

      {/* The teaching affordance. A quiet trailing action rather than a button in
          the row above: it must not compete with Send, and it must not look like a
          warning about the statement it follows.

          Underlined AT REST — the same treatment, for the same reason, as the
          engagement notice's control. Both are quiet inline actions sitting in
          running prose at prose weight and prose colour, and an affordance that
          only appears on hover is invisible to the person deciding whether there
          is anything here to press (and never appears at all on touch). Dotted
          keeps it an offer rather than a call to action. */}
      {mode === 'agent' && !agentTagged && onMentionSomeone && (
        <button
          type="button"
          data-testid="composer-mention-offer"
          title={t('mentions.addressee.mentionSomeone')}
          onClick={onMentionSomeone}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded px-1 text-xs touch-target',
            'text-muted-foreground transition-colors duration-quick ease-out',
            'underline decoration-dotted decoration-from-font underline-offset-[3px]',
            'hover:text-foreground hover:decoration-solid',
            'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          )}
        >
          {/* No leading separator. A "·" reads as a divider only while the offer
              sits on the SAME line as the statement; once it wraps to its own line
              the dot leads the line and reads as a stray bullet. The at-rest
              underline and the `@` glyph already mark this as a separate control,
              so the dot was carrying no meaning the reader was missing. */}
          <AtSign className="size-3.5 shrink-0" aria-hidden />
          {/* Folds to the `@` where the composer card is under 28rem (a phone), so
              the offer shares the row with the actions; the name stays for the
              screen reader, and the title for a pointer. */}
          <span className="sr-only @md:not-sr-only">{t('mentions.addressee.mentionSomeone')}</span>
        </button>
      )}
    </p>
  )
}

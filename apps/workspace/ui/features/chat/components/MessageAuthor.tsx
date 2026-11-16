'use client'

import { type FC } from 'react'
import Image from 'next/image'
import { avatarColorStyle, personInitials } from '@/components/ui/avatar-identity'
import { isOptimizableAvatarUrl } from '@/lib/images/avatar-hosts'
import { formatTime } from '@/shared/utils/format-time'
import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { cn } from '@/lib/utils'

export interface MessageAuthorProps {
  userId?: string | null
  name?: string | null
  avatarUrl?: string | null
  isYou?: boolean
  timestamp?: Date | string
  grouped?: boolean
  side?: 'end' | 'start'
  className?: string
}

const AVATAR_CLASS =
  'flex size-[22px] shrink-0 items-center justify-center overflow-hidden rounded-full text-[9.5px] font-semibold uppercase leading-none'

export const MessageAuthor: FC<MessageAuthorProps> = ({
  userId,
  name,
  avatarUrl,
  isYou = false,
  timestamp,
  grouped = false,
  side = 'end',
  className,
}) => {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()

  const displayName = isYou ? t('thread.authorYou') : (name?.trim() || t('inbox.unknownActor'))
  const label = grouped
    ? t('thread.groupedAria', { name: displayName })
    : t('thread.authorAria', { name: displayName })

  if (grouped) {
    return <span className="sr-only">{label}</span>
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        side === 'start' ? 'flex-row pl-[14px]' : 'flex-row-reverse pr-[14px]',
        className,
      )}
      role="group"
      aria-label={label}
      data-testid="message-author"
    >
      {/* Allow-listed avatar hosts are optimized server-side: no reader's IP reaches a third party. */}
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={22}
          height={22}
          unoptimized={!isOptimizableAvatarUrl(avatarUrl)}
          aria-hidden="true"
          className={cn(AVATAR_CLASS, 'object-cover')}
          data-testid="message-author-avatar"
        />
      ) : (
        <span
          className={AVATAR_CLASS}
          style={userId ? avatarColorStyle(userId) : undefined}
          aria-hidden="true"
          data-testid="message-author-initials"
        >
          {/* Initials come from the real name even for your own messages, whose
              label is "You" — "Y" on every one of your discs reads as a bug. */}
          {name?.trim() ? personInitials(name) : userId ? personInitials(displayName) : '?'}
        </span>
      )}

      <span className="flex items-baseline gap-1.5" aria-hidden="true">
        <span className="text-xs font-medium leading-none text-foreground">
          {displayName}
        </span>
        {timestamp && (
          <span className="text-subtle text-xs leading-none tabular-nums">
            {formatTime(timestamp, locale)}
          </span>
        )}
      </span>
    </div>
  )
}

'use client'

import type { JSX } from 'react'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { avatarColorStyle, avatarHue, personInitials } from './avatar-identity'

export interface AvatarStackPerson {
  userId: string
  name: string
  profilePictureUrl?: string | null
}

export const AVATAR_STACK_SIZES = {
  sm: 'size-7 text-[10px]',
  md: 'size-8 text-xs',
} as const

export type AvatarStackSize = keyof typeof AVATAR_STACK_SIZES

const DEFAULT_MAX = 4

export type AvatarTone = 'identity' | 'neutral'

export interface PersonAvatarProps {
  person: AvatarStackPerson
  size?: AvatarStackSize
  tone?: AvatarTone
  className?: string
}

export function PersonAvatar({ person, size = 'md', tone = 'identity', className }: PersonAvatarProps): JSX.Element {
  return (
    <Avatar
      className={cn(AVATAR_STACK_SIZES[size], className)}
      data-testid="person-avatar"
      data-avatar-hue={avatarHue(person.userId)}
    >
      {person.profilePictureUrl && <AvatarImage src={person.profilePictureUrl} alt="" />}
      <AvatarFallback
        className={cn('font-medium', tone === 'neutral' && 'bg-desk text-foreground')}
        style={tone === 'identity' ? avatarColorStyle(person.userId) : undefined}
      >
        {personInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  )
}

export interface AvatarStackProps {
  people: readonly AvatarStackPerson[]
  max?: number
  size?: AvatarStackSize
  tone?: AvatarTone
  renderPerson?: (
    person: AvatarStackPerson,
    face: React.ReactNode,
    index: number
  ) => React.ReactNode
  className?: string
}

export function AvatarStack({
  people,
  max = DEFAULT_MAX,
  size = 'md',
  tone = 'identity',
  renderPerson,
  className,
}: AvatarStackProps): JSX.Element | null {
  if (people.length === 0) return null

  const visible = people.slice(0, Math.max(1, max))
  const overflow = people.length - visible.length

  return (
    <span
      data-slot="avatar-stack"
      className={cn('inline-flex shrink-0 items-center -space-x-1', className)}
    >
      {visible.map((person, index) => {
        const face = (
          <PersonAvatar
            person={person}
            size={size}
            tone={tone}
            className="ring-2 ring-card"
          />
        )
        return (
          <React.Fragment key={`${person.userId}-${index}`}>
            {renderPerson ? renderPerson(person, face, index) : face}
          </React.Fragment>
        )
      })}
      {overflow > 0 && (
        <span
          data-slot="avatar-stack-overflow"
          data-testid="avatar-stack-overflow"
          className={cn(
            'relative inline-flex items-center justify-center rounded-full bg-muted font-semibold tabular-nums text-muted-foreground ring-2 ring-card',
            AVATAR_STACK_SIZES[size]
          )}
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}

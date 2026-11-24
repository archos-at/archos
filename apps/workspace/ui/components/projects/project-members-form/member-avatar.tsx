'use client'

import type { JSX } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from './member-initials'
import type { Member } from './member-types'

export function MemberAvatar({ member, className }: { member: Member; className?: string }): JSX.Element {
  return (
    <Avatar className={className}>
      {member.profilePictureUrl && <AvatarImage src={member.profilePictureUrl} alt="" />}
      <AvatarFallback className="text-xs font-medium">
        {initials(member.name)}
      </AvatarFallback>
    </Avatar>
  )
}

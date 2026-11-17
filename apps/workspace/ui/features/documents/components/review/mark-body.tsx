'use client'

import type { JSX } from 'react'
import { MentionText } from '@/features/collaboration/components/MentionText'
import type { MarkMention } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'

export function MarkBody({
  text,
  mentions,
  viewerId,
  clamped = false,
}: {
  text: string
  mentions?: readonly MarkMention[]
  viewerId: string | null
  clamped?: boolean
}): JSX.Element {
  return (
    <MentionText
      content={text}
      mentions={mentions}
      currentUserId={viewerId}
      meTone="ink"
      className={cn(clamped && 'whitespace-normal')}
    />
  )
}

'use client'

import type { JSX } from 'react'
import { FittedName } from '@/components/ui/fitted-name'

export function FileName({
  text,
  className,
  lines = 1,
  firstLineInset,
}: {
  text: string
  className?: string
  lines?: number
  firstLineInset?: number
}): JSX.Element {
  return <FittedName text={text} lines={lines} firstLineInset={firstLineInset} className={className} />
}

export function FolderName({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <span className={`block min-w-0 truncate ${className ?? ''}`} title={text}>
      {text}
    </span>
  )
}

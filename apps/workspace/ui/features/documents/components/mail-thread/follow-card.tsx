'use client'

import type { JSX, ReactNode } from 'react'

export function FollowCardHint({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <p className="text-muted-foreground text-xs leading-snug" data-testid={testId}>
      {children}
    </p>
  )
}

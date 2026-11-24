'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { ExternalLink } from 'lucide-react'

export function ExternalTextLink({
  href,
  testId,
  children,
}: {
  href: string
  testId: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="text-primary pointer-coarse:min-h-11 inline-flex items-center gap-1 hover:underline"
    >
      <ExternalLink className="size-3.5" aria-hidden />
      {children}
    </a>
  )
}

'use client'

import type { JSX } from 'react'
import * as React from 'react'

import { Chip, ChipCount } from '@/components/ui/chip'

export function StatusFilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  children: React.ReactNode
}): JSX.Element {
  return (
    <Chip asChild interactive variant={active ? 'default' : 'outline'}>
      <button type="button" aria-pressed={active} onClick={onClick}>
        {children}
        {count === undefined ? null : <ChipCount count={count} />}
      </button>
    </Chip>
  )
}

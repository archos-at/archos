'use client'

import type { JSX } from 'react'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SectionHeader({
  title,
  description,
}: {
  title: string
  description?: string
}): JSX.Element {
  return (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
  )
}

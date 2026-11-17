'use client'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CARD_SHELL } from './card-chrome'

export const CARD_PLACEHOLDER_HEIGHT = 96

export const CardPlaceholder = ({ height = CARD_PLACEHOLDER_HEIGHT }: { height?: number | string }) => (
  <Card aria-hidden="true" data-slot="card-placeholder" className={cn(CARD_SHELL, 'gap-2 p-5')} style={{ height }}>
    <Skeleton className="h-3 w-24 shrink-0" />
    <Skeleton className="h-4 w-2/3 shrink-0" />
    <Skeleton className="min-h-0 w-full flex-1" />
  </Card>
)

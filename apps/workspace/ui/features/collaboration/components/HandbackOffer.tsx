'use client'

import type { JSX } from 'react'
import { X } from 'lucide-react'

import { AvatarStack, type AvatarStackPerson } from '@/components/ui/avatar-stack'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { cn } from '@/lib/utils'

export interface HandbackOfferProps {
  people: readonly AvatarStackPerson[]
  onAccept: () => void
  onDismiss: () => void
  className?: string
}

export function HandbackOffer({
  people,
  onAccept,
  onDismiss,
  className,
}: HandbackOfferProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  if (people.length === 0) return null

  const names = people.map((person) => person.name)
  const offer =
    names.length === 1
      ? t('mentions.handback.offer', { name: names[0] })
      : t('mentions.handback.offerMany', { names: names.join(', ') })

  return (
    <div
      data-testid="handback-offer"
      role="status"
      className={cn(
        'flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-card px-3.5 py-2 shadow-xs',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AvatarStack people={people} size="sm" max={3} />
        <span className="min-w-0 text-xs text-foreground">{offer}</span>
      </span>

      <span className="flex items-center gap-1">
        <Button variant="secondary" size="sm" className="h-7 gap-1.5 text-xs" onClick={onAccept}>
          {t('mentions.handback.action')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={t('mentions.handback.dismiss')}
          title={t('mentions.handback.dismiss')}
          onClick={onDismiss}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </span>
    </div>
  )
}

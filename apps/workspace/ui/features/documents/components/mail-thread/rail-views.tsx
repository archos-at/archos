'use client'

import type { JSX, ReactNode } from 'react'
import { ListTree, Mail } from 'lucide-react'
import { CountPill } from '@/components/ui/count-pill'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslations } from '@/i18n'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

export type RailView = 'mail' | 'details'

export interface ThreadRailViewsProps {
  mail: ReactNode | null
  mailCount: number
  value: RailView
  onValueChange: (next: RailView) => void
  detailsLabel: string
  children: ReactNode
}

export function ThreadRailViews({ mail, mailCount, value, onValueChange, detailsLabel, children }: ThreadRailViewsProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  if (mail === null) return <>{children}</>
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next === 'details' ? 'details' : 'mail')} className="min-h-0 gap-3">
      <TabsList aria-label={t('tab.views')} className="h-8 w-full shrink-0">
        <TabsTrigger value="mail" className="text-xs" data-testid="file-rail-tab-mail">
          <Mail aria-hidden className="size-3.5" />
          {t('tab.label')}
          {/* The quiet number beside a tab label is the kit's muted pill; the words are for a screen reader. */}
          <CountPill count={mailCount} tone="muted" aria-hidden />
          <span className="sr-only">({t('tab.count', { count: mailCount })})</span>
        </TabsTrigger>
        <TabsTrigger value="details" className="text-xs" data-testid="file-rail-tab-details">
          <ListTree aria-hidden className="size-3.5" />
          {detailsLabel}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="mail" className="mt-0 flex flex-col">
        {mail}
      </TabsContent>
      <TabsContent value="details" forceMount className="mt-0 flex flex-col data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    </Tabs>
  )
}

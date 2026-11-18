'use client'

import { type FC, type ReactNode } from 'react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export const NotFoundFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="not-found" className="my-4 @container break-inside-avoid">
    <div className="grid gap-2 @[40rem]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]">{children}</div>
  </div>
)

export const NotFoundPane: FC<{ label: string; pane: string; children: ReactNode }> = ({ label, pane, children }) => (
  <section
    data-pane={pane}
    className={cn(
      'flex min-w-0 flex-col gap-1.5 rounded-surface px-3.5 py-3 text-sm [&_figure]:my-0 [&_p:last-child]:mb-0',
      pane === 'rule' ? 'bg-card ring-1 ring-border' : 'bg-muted/40'
    )}
  >
    <SectionLabel as="h4">{label}</SectionLabel>
    {children}
  </section>
)

export const SearchedList: FC<{ items: readonly { title: string; detail?: string }[]; more: number }> = ({ items, more }) => {
  const t = useTranslations(commonCopy)
  if (items.length === 0) return <p className="card-caption text-muted-foreground">{t('markdown.notFound.nothingRecorded')}</p>
  return (
    <ul className="flex list-none flex-col gap-1 pl-0" data-testid="searched-list">
      {items.map((item) => (
        <li key={`${item.title}-${item.detail ?? ''}`} className="card-caption min-w-0 break-words text-foreground">
          {item.title}
          {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
        </li>
      ))}
      {more > 0 && <li className="card-meta text-muted-foreground">{t('markdown.notFound.more', { count: more })}</li>}
    </ul>
  )
}

'use client'

import type { JSX } from 'react'
import { Mail } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'
import { documentDisplayName } from '@/lib/documents/display-name'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { FileItem } from '../../file-types'

type ListedFile = Pick<FileItem, 'filename' | 'displayName' | 'mailThread'>

export function listedFileName(file: ListedFile): string {
  const name = documentDisplayName(file)
  return file.mailThread ? name.replace(/\.md$/i, '') : name
}

export function useMailThreadFileFacts(file: Pick<FileItem, 'mailThread'>): string | null {
  const t = useTranslations(mailThreadCopy)
  const { locale } = useLocale()
  const thread = file.mailThread
  if (!thread) return null
  const count = t('tab.count', { count: thread.entryCount })
  return thread.lastEntryAt ? t('file.facts', { count, date: formatCalendarDate(thread.lastEntryAt, locale) }) : count
}

export function MailThreadFileFacts({ file, className }: { file: Pick<FileItem, 'mailThread'>; className?: string }): JSX.Element | null {
  const facts = useMailThreadFileFacts(file)
  if (!facts) return null
  return (
    <span className={cn('text-meta text-muted-foreground tabular-nums', className)} data-testid="mail-thread-file-facts">
      {facts}
    </span>
  )
}

export function MailThreadThumbnail(): JSX.Element {
  return (
    <div
      aria-hidden
      data-kind="mail-thread"
      data-testid="document-kind-thumbnail"
      data-state="placeholder"
      className="text-muted-foreground absolute inset-0 flex flex-col justify-center gap-[9px] px-[18px] py-[14px]"
    >
      {[64, 52, 58].map((width, index) => (
        <div key={index} className="flex items-center gap-2">
          <Mail className="size-3.5 shrink-0 opacity-50" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <div className="h-[4px] rounded-control bg-current opacity-35" style={{ width: `${width}%` }} />
            <div className="h-[4px] w-[88%] rounded-control bg-current opacity-15" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function useMailThreadHeaderFacts(thread: { entryCount: number } | null): string | null {
  const t = useTranslations(mailThreadCopy)
  if (!thread) return null
  return `${t('file.kind')} · ${t('tab.count', { count: thread.entryCount })}`
}

export function useMailThreadKindLabel(): string {
  return useTranslations(mailThreadCopy)('file.kind')
}

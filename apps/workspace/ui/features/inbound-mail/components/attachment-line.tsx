'use client'

import type { JSX } from 'react'
import { Item } from '@/components/ui/item'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import type { AttachmentCase, NotStagedSummary } from '../lib/attachment-case'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { AttachmentFacts, AttachmentNoteLine, AttachmentPicture, AttachmentStatusLine } from './attachment-row'

export function NotStagedList({ notStaged, originalHeld }: { notStaged: NotStagedSummary; originalHeld: boolean }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  if (notStaged.listed.length === 0 && notStaged.layoutImages === 0) return null
  return (
    <ul className="text-muted-foreground flex flex-col gap-1 px-1 text-xs" data-testid="not-staged">
      {notStaged.listed.map((entry, index) => (
        <li key={`${entry.filename}-${index}`} className="[overflow-wrap:anywhere]">
          {t(`attachments.notStaged.${entry.reason}`, { name: entry.filename })}
        </li>
      ))}
      {notStaged.layoutImages > 0 && <li>{t('attachments.notStaged.layoutImages', { count: notStaged.layoutImages })}</li>}
      {(notStaged.layoutImages > 0 || notStaged.listed.some((entry) => entry.reason !== 'calendar')) && originalHeld && (
        <li className="text-foreground pt-1" data-testid="not-staged-original">
          {t('attachments.notStaged.original')}
        </li>
      )}
    </ul>
  )
}

export interface AttachmentLineProps {
  projectId: string
  entry: AttachmentCase
  name: string
  /** What filing does with it, in one muted phrase; nothing once it is no longer waiting. */
  phrase: string | null
  contentUrl: string | null
  onPreview?: (trigger: HTMLElement) => void
}

/** An attachment as the mail shows it: what it is and where it goes. Nothing on it is pressed but „Vorschau“; „Einordnen“ edits. */
export function AttachmentLine({ projectId, entry, name, phrase, contentUrl, onPreview }: AttachmentLineProps): JSX.Element {
  const { part, status } = entry
  const failure = entry.notes.find((note) => note.kind === 'last_failure')
  return (
    <Item
      as="li"
      className={cn('items-start px-4 [--row-end:16px] [--row-text:72px]', ROW_HAIRLINE)}
      data-testid={`attachment-${part.id}`}
      data-status={status}
    >
      <AttachmentPicture name={name} contentType={part.contentType} contentUrl={contentUrl} onPreview={onPreview} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <MiddleTruncate text={name} className="min-w-0 text-sm font-medium" />
        <AttachmentFacts name={name} part={part} contentUrl={contentUrl} onPreview={onPreview} />
        <AttachmentStatusLine projectId={projectId} entry={entry} />
        {status === 'waiting' && failure && <AttachmentNoteLine projectId={projectId} note={failure} />}
        {phrase && (
          <p className="text-muted-foreground text-xs first-letter:uppercase [overflow-wrap:anywhere]" data-testid="attachment-plan">
            {phrase}
          </p>
        )}
      </div>
    </Item>
  )
}

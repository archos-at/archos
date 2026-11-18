'use client'

import type { FC, MouseEvent } from 'react'
import { documentFilesHref, openFiledDocument } from '@/features/documents/chat-card-parts'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { DraftFiling } from '../hooks/use-draft-filing'

export const DRAFT_ACTION = cn(
  'inline-flex min-h-11 items-center rounded-control font-medium text-primary',
  'transition-colors duration-quick ease-out motion-reduce:transition-none',
  'hover:text-primary/80 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
  'aria-disabled:cursor-default aria-disabled:opacity-60',
)

interface FiledTarget {
  documentId: string
  projectId: string
  href: string
  isMobile: boolean
}

export function openFiled(target: FiledTarget): void {
  if (target.isMobile) {
    window.location.assign(target.href)
    return
  }
  void openFiledDocument({ documentId: target.documentId, projectId: target.projectId }).then((opened) => {
    if (!opened) window.location.assign(target.href)
  })
}

export function openFiledInPlace(event: MouseEvent<HTMLAnchorElement>, target: FiledTarget): void {
  if (target.isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  openFiled(target)
}

export const DraftConflictNotice: FC<{ filing: DraftFiling }> = ({ filing }) => {
  const t = useTranslations(chatCopy)
  const { conflict, projectId, isFiling } = filing
  if (!conflict || filing.shownFiled) return null
  return (
    <div className="flex flex-col gap-1" data-testid="document-draft-conflict">
      <p className="card-caption text-muted-foreground">{t('cards.documentDraft.fileConflict')}</p>
      <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
        {projectId && (
          <a
            href={documentFilesHref(projectId, conflict.documentId)}
            className={DRAFT_ACTION}
            data-testid="document-draft-conflict-open"
          >
            {conflict.displayName}
          </a>
        )}
        <button
          type="button"
          className={DRAFT_ACTION}
          aria-disabled={isFiling || undefined}
          aria-busy={isFiling || undefined}
          onClick={() => void filing.file(true)}
        >
          <StackedLabel
            busy={isFiling}
            idle={t('cards.documentDraft.fileAnyway')}
            working={t('cards.documentDraft.filing')}
          />
        </button>
      </p>
    </div>
  )
}

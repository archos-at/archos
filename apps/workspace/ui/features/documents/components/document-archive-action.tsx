'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'

export interface DocumentArchiveActionProps {
  filename?: string | null
  pending?: boolean
  onArchive: () => void
  compact?: boolean
  className?: string
}

const CONSEQUENCES = ['listing', 'knowledge', 'kept', 'permanent'] as const

export function DocumentArchiveAction({
  filename,
  pending = false,
  onArchive,
  compact = false,
  className,
}: DocumentArchiveActionProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const [asking, setAsking] = useState(false)

  return (
    <div className={cn(compact ? 'border-t pt-2' : 'space-y-1.5 border-t pt-3', className)} data-testid="document-archive-action">
      {compact ? (
        <Button
          type="button"
          size="sm"
          variant="link"
          className="text-muted-foreground hover:text-foreground touch-target -ml-1 h-auto px-1 py-0.5 text-xs pointer-coarse:h-auto"
          disabled={pending}
          aria-busy={pending}
          data-testid="document-lifecycle-archive"
          onClick={() => setAsking(true)}
        >
          {t('preview.revision.rail.archive')}
        </Button>
      ) : (
        <>
          <p className="text-xs font-medium">{t('lifecycle.archiveSection.heading')}</p>
          <p className="text-muted-foreground text-xs">{t('lifecycle.archiveSection.blurb')}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              disabled={pending}
              aria-busy={pending}
              data-testid="document-lifecycle-archive"
              onClick={() => setAsking(true)}
            >
              {t('lifecycle.actions.archive')}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        tone="warning"
        title={
          filename
            ? t('lifecycle.archiveSection.confirmTitleNamed', { filename })
            : t('lifecycle.archiveSection.confirmTitle')
        }
        description={
          <ul className="mt-1 space-y-1.5" data-testid="document-archive-consequences">
            {CONSEQUENCES.map((key) => (
              <li key={key} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground select-none">
                  ·
                </span>
                <span>{t(`lifecycle.archiveSection.consequences.${key}`)}</span>
              </li>
            ))}
          </ul>
        }
        confirmLabel={t('lifecycle.actions.archive')}
        cancelLabel={t('lifecycle.comment.cancel')}
        pending={pending}
        confirmTestId="document-archive-confirm"
        onConfirm={() => {
          setAsking(false)
          onArchive()
        }}
      />
    </div>
  )
}

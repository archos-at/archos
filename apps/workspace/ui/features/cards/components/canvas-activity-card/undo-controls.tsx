'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'

export function UndoButton({ number, busy, onClick }: { number: number; busy: boolean; onClick: () => void }): JSX.Element {
  const t = useTranslations(chatCopy)
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      aria-label={t('cards.canvasActivity.undoLabel', { number })}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className="aria-disabled:cursor-default"
    >
      <StackedLabel busy={busy} idle={t('cards.canvasActivity.undo')} working={t('cards.canvasActivity.undoing')} />
    </Button>
  )
}

export function UndoMessages({ notice, error }: { notice: string | null; error: string | null }): JSX.Element {
  return (
    <>
      {notice && (
        <p className="card-caption text-muted-foreground" role="status" data-testid="canvas-activity-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="card-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

'use client'

import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export function PaneLoadError({
  message,
  onRetry,
  inline = false,
}: {
  message: string
  onRetry: () => void
  inline?: boolean
}) {
  const t = useTranslations(filesCopy)
  const retry = (
    <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={onRetry} data-attr="files-pane-retry">
      <RotateCcw className="size-3.5" aria-hidden />
      {t('workspace.tryAgain')}
    </Button>
  )
  if (!inline) return <EmptyState variant="bare" icon={AlertCircle} title={message} action={retry} />
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {retry}
    </div>
  )
}

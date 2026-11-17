'use client'

import type { JSX } from 'react'
import { AlertCircle, Upload, X } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { useDocumentsStore } from '../store'

export function UploadAnywayButton({ className }: { className?: string }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const stopped = useDocumentsStore((s) => s.nameStopped)
  const clearError = useDocumentsStore((s) => s.clearError)
  if (!stopped) return null
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn('mt-2 h-7 px-2 text-xs', className)}
      title={t('errors.uploadAnywayHint')}
      onClick={() => {
        clearError()
        stopped.uploadAnyway()
      }}
      data-testid="upload-anyway"
    >
      <Upload className="size-3.5" aria-hidden />
      {t('errors.uploadAnyway', { count: stopped.count })}
    </Button>
  )
}

export function UploadProblemAlert({ message, onDismiss }: { message: string; onDismiss: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="border-b px-4 py-3 animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none">
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>{t('workspace.uploadProblem')}</AlertTitle>
        <AlertDescription>
          {message}
          <UploadAnywayButton className="flex" />
        </AlertDescription>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-6"
          onClick={onDismiss}
          aria-label={t('workspace.dismissError')}
        >
          <X className="size-4" />
        </Button>
      </Alert>
    </div>
  )
}

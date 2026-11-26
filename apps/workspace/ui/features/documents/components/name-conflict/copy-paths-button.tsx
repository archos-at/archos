'use client'

import type { JSX } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { conflictListText } from '../../lib/name-conflict'

export function CopyPathsButton({ paths, testId }: { paths: readonly string[]; testId: string }): JSX.Element {
  const t = useTranslations(filesCopy)
  const [copied, raiseCopied] = useTransientFlag()
  const copy = (): void => {
    void navigator.clipboard?.writeText(conflictListText(paths)).then(raiseCopied, () => {})
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={copy}
      aria-label={t('nameConflicts.copyAria', { count: paths.length })}
      data-testid={testId}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? t('nameConflicts.copied') : t('nameConflicts.copy')}
    </Button>
  )
}

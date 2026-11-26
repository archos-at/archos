'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Check, CircleAlert, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { conflictListText } from '../../lib/name-conflict'

export function CopyPathsButton({ paths, testId }: { paths: readonly string[]; testId: string }): JSX.Element {
  const t = useTranslations(filesCopy)
  const [shown, raise] = useTransientFlag()
  const [outcome, setOutcome] = useState<'copied' | 'failed'>('copied')
  const settle = (next: 'copied' | 'failed') => () => {
    setOutcome(next)
    raise()
  }
  const copy = (): void => {
    const writing = navigator.clipboard?.writeText(conflictListText(paths))
    if (!writing) {
      settle('failed')()
      return
    }
    void writing.then(settle('copied'), settle('failed'))
  }
  const state = shown ? outcome : null
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copy}
        aria-label={t('nameConflicts.copyAria', { count: paths.length })}
        data-testid={testId}
        data-state={state ?? 'idle'}
      >
        {state === 'copied' ? <Check aria-hidden /> : state === 'failed' ? <CircleAlert aria-hidden /> : <Copy aria-hidden />}
        {state === 'copied' ? t('nameConflicts.copied') : state === 'failed' ? t('nameConflicts.copyFailed') : t('nameConflicts.copy')}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? t('nameConflicts.copied') : state === 'failed' ? t('nameConflicts.copyFailed') : ''}
      </span>
    </>
  )
}

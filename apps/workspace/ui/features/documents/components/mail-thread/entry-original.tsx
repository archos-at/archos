'use client'

import type { JSX } from 'react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Download, ShieldAlert, Timer } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { FactLine } from '@/components/ui/fact-line'
import { useTranslations } from '@/i18n'
import type { MailThreadEntryView } from '@/lib/mail-thread/mail-thread-wire'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

export type OriginalState = 'available' | 'not_clean' | 'scanning' | 'gone'

export function originalState(entry: Pick<MailThreadEntryView, 'original'>): OriginalState {
  if (entry.original === null) return 'gone'
  switch (entry.original.scanStatus) {
    case 'clean':
      return 'available'
    case 'infected':
      return 'not_clean'
    case 'pending':
    case 'failed':
      return 'scanning'
  }
}

export interface EntryOriginalProps {
  entry: Pick<MailThreadEntryView, 'original'>
  download: () => Promise<{ saved: true } | { saved: false; status: number | null; reason: string | null }>
}

export function EntryOriginal({ entry, download }: EntryOriginalProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  const [answered, setAnswered] = useState<OriginalState | null>(null)
  const [busy, setBusy] = useState(false)
  const hintId = useId()
  const state = answered ?? originalState(entry)

  const press = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await download()
      if (result.saved) return
      if (result.reason === 'original_not_clean') setAnswered('not_clean')
      else if (result.reason === 'gone') setAnswered('gone')
      else toast.error(t('original.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (state === 'not_clean') {
    return (
      <FactLine icon={ShieldAlert} tone="danger" testId="mail-entry-original" data-state="not_clean">
        {t('original.notClean')}
      </FactLine>
    )
  }
  if (state === 'gone' || state === 'scanning') {
    const Icon = state === 'gone' ? Archive : Timer
    return (
      <FactLine icon={Icon} testId="mail-entry-original" data-state={state}>
        {t(state === 'gone' ? 'original.gone' : 'original.scanning')}
      </FactLine>
    )
  }
  return (
    <span className="inline-flex">
      <BusyButton
        type="button"
        variant="secondary"
        size="sm"
        busy={busy}
        busyLabel={t('original.downloading')}
        icon={<Download aria-hidden />}
        title={t('original.hint')}
        aria-describedby={hintId}
        onClick={() => void press()}
        data-testid="mail-entry-original"
        data-state="available"
      >
        {t('original.download')}
      </BusyButton>
      {/* The warning before the press: a screen reader hears it with the button, a pointer reads it as the title. */}
      <span id={hintId} className="sr-only">
        {t('original.hint')}
      </span>
    </span>
  )
}

'use client'

import type { JSX } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SuggestionPanel } from '@/components/ui/suggestion-panel'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { MailImportView } from '@/lib/mail-import/types'
import type { UseMailImports } from '../hooks/use-mail-imports'

type Translate = ReturnType<typeof useTranslations>

type ImportsState = Pick<UseMailImports, 'list' | 'sending'>

interface Ongoing {
  label: string
  count: number
}

const filing = (row: MailImportView) => row.status === 'queued' || row.status === 'importing'
const interruptedBy = (sendingId: string | null) => (row: MailImportView) =>
  row.status === 'uploading' && row.ownedByViewer && row.id !== sendingId

function waitingRows(state: ImportsState): MailImportView[] {
  const sendingId = state.sending?.importId ?? null
  const interrupted = interruptedBy(sendingId)
  return (state.list?.imports ?? []).filter((row) => row.id !== sendingId && (interrupted(row) || filing(row)))
}

export const mailImportOngoing = (state: ImportsState): boolean => state.sending !== null || waitingRows(state).length > 0

function ongoing(state: ImportsState, t: Translate): Ongoing | null {
  const others = waitingRows(state)
  if (state.sending) {
    return { label: t('mailImport.sendingLabel', { name: state.sending.filename }), count: 1 + others.length }
  }
  const broken = others.find(interruptedBy(null))
  if (broken) return { label: t('mailImport.line.interrupted', { name: broken.filename }), count: others.length }
  const first = others[0]
  if (first) return { label: t('mailImport.importingLabel', { name: first.filename }), count: others.length }
  return null
}

export function MailImportLine({
  state,
  onOpen,
}: {
  state: ImportsState
  onOpen: () => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const now = ongoing(state, t)
  if (!now) return null
  return (
    <SuggestionPanel className="animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none" data-testid="mail-import-line">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-xs">
        <Mail className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 font-medium break-all">{now.label}</span>
        {now.count > 1 && (
          <span className="text-muted-foreground">{t('mailImport.line.more', { count: now.count - 1 })}</span>
        )}
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <Button type="button" variant="inline" className="touch-target" onClick={onOpen} data-testid="mail-import-line-open">
          {t('mailImport.line.open')}
        </Button>
      </p>
    </SuggestionPanel>
  )
}

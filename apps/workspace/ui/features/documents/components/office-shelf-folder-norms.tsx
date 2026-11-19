'use client'

import { useEffect, useState, type JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BusyButton } from '@/components/ui/busy-button'
import { useTranslations } from '@/i18n'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { decideFolderNorms, fetchFolderNorms } from '@/lib/office-shelf/folder-norms-client'
import type { DecideFolderNormsBody, FolderNormsDecision } from '@/lib/office-shelf/folder-norms-wire'

type Action = DecideFolderNormsBody['action']

export interface OfficeShelfFolderNormsProps {
  folderId: string
  onChanged: () => void
  onRecorded?: (documentIds: string[]) => void
  className?: string
}

export function OfficeShelfFolderNorms({ folderId, onChanged, onRecorded, className }: OfficeShelfFolderNormsProps): JSX.Element | null {
  const t = useTranslations(officeShelfCopy)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState<Action | null>(null)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    let live = true
    fetchFolderNorms(folderId).then(
      (found) => live && setTotal(found.total),
      () => live && setTotal(0),
    )
    return () => {
      live = false
    }
  }, [folderId, reads])

  if (total === 0) return null

  const announce = (decision: FolderNormsDecision): void => {
    if (decision.action === 'keep') toast.success(t('folderNorms.kept'))
    else if (decision.done.length > 0 && onRecorded) {
      onRecorded(decision.done.map((norm) => norm.documentId))
      if (decision.remaining > 0) toast(t('folderNorms.recordedMore', { count: decision.done.length, remaining: decision.remaining }))
    } else if (decision.done.length > 0) {
      toast.success(
        decision.remaining > 0
          ? t('folderNorms.recordedMore', { count: decision.done.length, remaining: decision.remaining })
          : t('folderNorms.recorded', { count: decision.done.length }),
      )
    }
    if (decision.failed.length > 0) toast.error(t('folderNorms.recordFailed', { count: decision.failed.length }))
  }

  const decide = async (action: Action): Promise<void> => {
    if (busy) return
    setBusy(action)
    try {
      announce(await decideFolderNorms(folderId, { action }))
      onChanged()
    } catch {
      toast.error(t('folderNorms.failed'))
    } finally {
      setBusy(null)
      setReads((count) => count + 1)
    }
  }

  return (
    <div className={className}>
      <Alert data-testid="office-shelf-folder-norms">
        <Sparkles aria-hidden />
        <AlertTitle className="line-clamp-none">
          {total === 1 ? t('folderNorms.foundOne') : t('folderNorms.foundMany', { count: total })}
        </AlertTitle>
        <AlertDescription>
          <p>{t('folderNorms.explanation')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <BusyButton
              size="sm"
              busy={busy === 'record'}
              blocked={busy === 'keep'}
              busyLabel={t('folderNorms.recording')}
              onClick={() => void decide('record')}
            >
              {t('folderNorms.record')}
            </BusyButton>
            <BusyButton
              size="sm"
              variant="ghost"
              busy={busy === 'keep'}
              blocked={busy === 'record'}
              busyLabel={t('folderNorms.keeping')}
              onClick={() => void decide('keep')}
            >
              {t('folderNorms.keep')}
            </BusyButton>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  )
}

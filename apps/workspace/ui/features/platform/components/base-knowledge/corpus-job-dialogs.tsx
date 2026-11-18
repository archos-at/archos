'use client'

import type { Dispatch, JSX, SetStateAction } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'

const CONFIRM_LIST_MAX = 5

interface CorpusJobDialogsProps {
  pendingReingest: string[]
  setPendingReingest: Dispatch<SetStateAction<string[]>>
  onReingest: () => void
  syncConfirmOpen: boolean
  setSyncConfirmOpen: Dispatch<SetStateAction<boolean>>
  onSync: () => void
}

export function CorpusJobDialogs({
  pendingReingest,
  setPendingReingest,
  onReingest,
  syncConfirmOpen,
  setSyncConfirmOpen,
  onSync,
}: CorpusJobDialogsProps): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <>
      <ConfirmDialog
        open={pendingReingest.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingReingest([])
        }}
        title={t('knowledgeAdmin.reingestConfirmTitle', { count: pendingReingest.length })}
        description={t('knowledgeAdmin.reingestConfirmDescription')}
        confirmLabel={t('knowledgeAdmin.reingestConfirmCta', { count: pendingReingest.length })}
        cancelLabel={t('knowledge.deleteCancel')}
        tone="warning"
        icon={RotateCcw}
        onConfirm={onReingest}
        pending={false}
        confirmTestId="knowledge-reingest-confirm"
      >
        <div className="flex flex-col gap-3">
          <NameList names={pendingReingest} />
          <CostNote>{t('knowledgeAdmin.reingestConfirmCost')}</CostNote>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={syncConfirmOpen}
        onOpenChange={setSyncConfirmOpen}
        title={t('knowledgeAdmin.syncConfirmTitle')}
        description={t('knowledgeAdmin.syncConfirmDescription')}
        confirmLabel={t('knowledgeAdmin.syncConfirmCta')}
        cancelLabel={t('knowledge.deleteCancel')}
        tone="warning"
        icon={RefreshCw}
        onConfirm={onSync}
        pending={false}
        confirmTestId="knowledge-sync-confirm"
      >
        <CostNote>{t('knowledgeAdmin.syncConfirmCost')}</CostNote>
      </ConfirmDialog>
    </>
  )
}

function NameList({ names }: { names: readonly string[] }): JSX.Element {
  const t = useTranslations(platformCopy)
  const shown = names.slice(0, CONFIRM_LIST_MAX)
  const rest = names.length - shown.length
  return (
    <ul className="flex flex-col gap-0.5" data-testid="confirm-name-list">
      {shown.map((name) => (
        <li key={name} className="text-foreground truncate font-mono text-xs">
          {name}
        </li>
      ))}
      {rest > 0 ? (
        <li className="text-xs">{t('knowledgeAdmin.reingestConfirmMore', { count: rest })}</li>
      ) : null}
    </ul>
  )
}

function CostNote({ children }: { children: string }): JSX.Element {
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

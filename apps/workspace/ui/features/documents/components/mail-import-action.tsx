'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSectionToolTier } from '@/components/shell/project-section-frame'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { MailImportDialog } from './mail-import-dialog'

export function MailImportAction({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations(filesCopy)
  const [open, setOpen] = useState(false)
  const tier = useSectionToolTier()
  const glyph = tier !== null && tier !== 'wide'
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="gap-2"
        onClick={() => setOpen(true)}
        data-testid="mail-import-trigger"
        title={glyph ? t('mailImport.action') : undefined}
        aria-label={glyph ? t('mailImport.action') : undefined}
      >
        <Mail className="size-4" aria-hidden />
        {!glyph && t('mailImport.action')}
      </Button>
      <MailImportDialog projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  )
}

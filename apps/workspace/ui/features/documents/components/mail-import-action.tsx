'use client'

/**
 * The Dateien header's way into the Outlook archive import (ADR-0085): one
 * outline button beside the upload control, project shelf only, and only where
 * the import is switched on. A peer of the upload button rather than an item in
 * its menu, because it is not an upload of files: it is a different kind of
 * source, and the menu's two items both mean "these files go here".
 */

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
  // Its glyph alone where the section's tool row has no room for its words (`SectionToolTier`): the row never wraps.
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

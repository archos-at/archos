'use client'

import { useRef, useState, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { FileDown, FolderInput, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { capturePosthog } from '@/lib/analytics/posthog'
import { downloadFetched } from '@/lib/browser-download'
import { ANNOTATION_EXPORT_FORMATS, type AnnotationExportFormat } from '@/lib/annotations/export-request'
import { projectProtocolHref, type ProjectMarksFilters } from '@/lib/annotations/project-types'
import { documentFilesHref } from '../../lib/document-question'
import { fileProtocol, ProtocolFilingError, protocolFilingStem } from '../../lib/protocol-filing'

export function ProjectProtocolMenu({
  projectId,
  filters,
  filing = null,
  restricted = null,
  compact = false,
}: {
  projectId: string
  filters: ProjectMarksFilters
  filing?: { projectName: string } | null
  restricted?: boolean | null
  compact?: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const filedHere = useRef(new Map<string, string>())

  const download = async (format: AnnotationExportFormat): Promise<void> => {
    setBusy(true)
    const result = await downloadFetched(projectProtocolHref(projectId, filters, format), `protokoll.${format}`)
    setBusy(false)
    if (result.saved) {
      capturePosthog('report_exported', { kind: 'open_points', format })
      return
    }
    toast.error(
      result.reason === 'too-many-marks'
        ? t('openPoints.export.tooMany')
        : result.status === 422 && format === 'pdf'
          ? t('review.export.tooLongForPdf')
          : t('openPoints.export.failed')
    )
  }

  const file = async (projectName: string): Promise<void> => {
    setBusy(true)
    const stem = protocolFilingStem((values) => t('openPoints.export.filedName', values), projectName)
    try {
      const filed = await fileProtocol((format) => projectProtocolHref(projectId, filters, format), { projectId, folderId: null }, stem)
      const again = filedHere.current.get(filed.filename) === filed.documentId
      filedHere.current.set(filed.filename, filed.documentId)
      const message = filed.unchanged
        ? t('review.export.filedUnchanged', { name: filed.filename })
        : again
          ? t('review.export.filedAgain', { name: filed.filename })
          : t('review.export.filed', { name: filed.filename })
      toast.success(message, {
        action: { label: t('review.export.openFiled'), onClick: () => router.push(documentFilesHref(projectId, filed.documentId)) },
      })
    } catch (error) {
      const taken = error instanceof ProtocolFilingError && error.reason === 'name-taken'
      toast.error(taken ? t('review.export.fileNameTaken', { name: stem }) : t('review.export.fileFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={t('openPoints.export.button')} data-testid="open-points-export">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="gap-1.5" disabled={busy}
            title={t('openPoints.export.hint')}
            data-testid="open-points-export"
          >
            <FileDown className="size-3.5" aria-hidden />
            {t('openPoints.export.button')}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" data-testid="open-points-export-menu">
        {compact && <DropdownMenuLabel>{t('openPoints.export.button')}</DropdownMenuLabel>}
        <DropdownMenuLabel>{t('openPoints.export.formatLabel')}</DropdownMenuLabel>
        {ANNOTATION_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem key={format} onSelect={() => void download(format)} data-testid={`open-points-export-${format}`}>
            {t(`review.export.formats.${format}`)}
          </DropdownMenuItem>
        ))}
        {filing && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void file(filing.projectName)}
              disabled={busy || restricted !== false}
              data-testid="open-points-export-file"
            >
              <FolderInput aria-hidden />
              {restricted ? (
                <DropdownMenuItemText title={t('review.export.fileInto')} hint={t('openPoints.export.fileRestricted')} />
              ) : busy ? (
                t('review.export.filing')
              ) : (
                t('review.export.fileInto')
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

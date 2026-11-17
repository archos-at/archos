'use client'

import type { JSX } from 'react'
import { useRef } from 'react'
import { FolderUp, RefreshCw, Upload } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { useCoarsePointer } from '@/features/documents/hooks/use-coarse-pointer'
import { ProjectUppyUpload } from '@/features/documents/components/project-uppy-upload'
import { useTranslations } from '@/i18n'
import { intakeReadingStepCopy } from '@/i18n/namespaces/intake-reading-step'
import { usePressed } from '../../hooks/use-pressed'
import type { ReadingDocuments } from './reading-milestones'

export interface DocumentTools {
  reread?: { busy: boolean; onReread: () => void | Promise<void> }
}

export interface AddDocumentsProps {
  projectId: string
  uploading: boolean
  onFiles: (files: File[]) => void
}

export function AddDocuments({
  projectId,
  uploading,
  onFiles,
  className,
}: AddDocumentsProps & {
  className?: string
}): JSX.Element {
  const t = useTranslations(intakeReadingStepCopy)
  const pickFiles = useRef<(() => void) | null>(null)
  const pickFolder = useRef<(() => void) | null>(null)
  const touch = useCoarsePointer()
  return (
    <>
      <span className="hidden">
        <ProjectUppyUpload
          projectId={projectId}
          onUpload={onFiles}
          isUploading={uploading}
          allowFolders
          pickFilesRef={pickFiles}
          pickFolderRef={pickFolder}
        />
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {className ? (
            <button data-attr="reading-add-documents" type="button" className={className} aria-busy={uploading || undefined} data-testid="reading-add-documents">
              {uploading ? t('documents.uploading') : t('documents.add')}
            </button>
          ) : (
            <Button
              type="button"
              variant="inline"
              className="text-muted-foreground hover:text-foreground font-normal pointer-coarse:min-h-11"
              aria-busy={uploading || undefined}
              data-testid="reading-add-documents"
            >
              {uploading ? t('documents.uploading') : t('documents.add')}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => pickFiles.current?.()}>
            <Upload aria-hidden />
            {t('documents.addFiles')}
          </DropdownMenuItem>
          {/* iOS has no folder picker; a finger is not offered what cannot work. */}
          {!touch && (
            <DropdownMenuItem onSelect={() => pickFolder.current?.()}>
              <FolderUp aria-hidden />
              {t('documents.addFolder')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

export function ReadingDocumentsBar({
  documents,
  showUnread,
  tools,
}: {
  documents: ReadingDocuments
  showUnread: boolean
  tools: DocumentTools
}): JSX.Element {
  const t = useTranslations(intakeReadingStepCopy)
  const [rereading, reread] = usePressed()
  const { read, total, unread } = documents
  const share = total === null ? (read > 0 ? 100 : 0) : total > 0 ? Math.round((read / total) * 100) : 0
  const label = total === null ? t('documents.read', { count: read }) : t('documents.of', { read, total })
  return (
    <div data-testid="reading-documents">
      <div className="flex items-center gap-3.5">
        <Progress
          value={share}
          className="bg-border h-1.5 flex-1"
          aria-label={total === null ? label : t('documents.aria', { read, total })}
        />
        <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">{label}</span>
      </div>
      {showUnread && unread > 0 && (
        <p className="text-muted-foreground mt-1.5 text-[13px]" data-testid="reading-unread">
          {t('documents.unread', { count: unread })}
          {tools.reread && (
            <>
              {' · '}
              <BusyButton
                type="button"
                variant="inline"
                className="gap-1 pointer-coarse:min-h-11"
                icon={<RefreshCw aria-hidden className="size-3.5" />}
                busy={rereading}
                blocked={tools.reread.busy}
                busyLabel={t('documents.rereadBusy')}
                aria-label={t('documents.rereadAria', { count: unread })}
                onClick={() => reread(async () => tools.reread?.onReread())}
              >
                {t('documents.reread')}
              </BusyButton>
            </>
          )}
        </p>
      )}
    </div>
  )
}

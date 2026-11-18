'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import { cn } from '@/lib/utils'
import { Camera, ChevronDown, FolderPlus, FolderUp, Images, Mail, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useInSectionToolRow, useSectionNewFolder, useSectionPrimaryYields, useSectionToolTier } from '@/components/shell/project-section-frame'
import { useCoarsePointer } from '../hooks/use-coarse-pointer'
import { useLocale, useTranslations } from '@/i18n'
import { captureCopy } from '@/i18n/namespaces/capture'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatBytes } from '@/lib/format'
import { useAppConfig } from '@/shared/context'
import { DEFAULT_ACCEPTED_FILE_TYPES, DEFAULT_MAX_FILE_SIZE } from '../constants'
import { withZipAccepted } from '../lib/zip-types'
import { documentsOnlyAccept, photoIntake, prepareSitePhotos } from '../lib/site-photo'

interface ProjectUppyUploadProps {
  projectId?: string
  folderId?: string | null
  onUpload: (files: File[]) => void
  isUploading: boolean
  variant?: 'default' | 'secondary'
  size?: 'sm' | 'default'
  label?: string
  glyphOnly?: boolean
  allowFolders?: boolean
  pickFilesRef?: MutableRefObject<(() => void) | null>
  pickFolderRef?: MutableRefObject<(() => void) | null>
  onSendByMail?: () => void
}

export function ProjectUppyUpload({
  onUpload,
  isUploading,
  variant = 'default',
  size = 'sm',
  label,
  glyphOnly = false,
  allowFolders = false,
  pickFilesRef,
  pickFolderRef,
  onSendByMail,
}: ProjectUppyUploadProps) {
  const t = useTranslations(filesCopy)
  const tCapture = useTranslations(captureCopy)
  const { locale } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const touch = useCoarsePointer()
  useEffect(() => {
    if (pickFilesRef) pickFilesRef.current = () => inputRef.current?.click()
    if (pickFolderRef) pickFolderRef.current = () => folderInputRef.current?.click()
    return () => {
      if (pickFilesRef) pickFilesRef.current = null
      if (pickFolderRef) pickFolderRef.current = null
    }
  }, [pickFilesRef, pickFolderRef])
  const buttonLabel = label ?? t('upload.upload')
  const tier = useSectionToolTier()
  const yields = useSectionPrimaryYields()
  const newFolder = useSectionNewFolder()
  const headerInstance = useInSectionToolRow() && !glyphOnly
  const compact = headerInstance && tier === 'narrow'
  const fileUpload = useAppConfig().fileUpload
  const acceptedTypes = withZipAccepted(fileUpload?.acceptedTypes ?? DEFAULT_ACCEPTED_FILE_TYPES)
  const maxFileSize = fileUpload?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  const photos = photoIntake({
    acceptedTypes: fileUpload?.acceptedTypes ?? DEFAULT_ACCEPTED_FILE_TYPES,
    imageUploadBlockedReason: fileUpload?.imageUploadBlockedReason ?? null,
  })
  const photoEntries = allowFolders && touch
  const filesAccept = photoEntries ? documentsOnlyAccept(acceptedTypes) : acceptedTypes

  const handleChange =
    (source: 'camera' | 'picker' = 'picker') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? [])
      e.target.value = ''
      if (selected.length === 0) return
      void prepareSitePhotos(selected, {
        source,
        prefix: tCapture('photos.fileNamePrefix'),
        imagesAccepted: photos.available,
      }).then(({ files, unconvertibleHeic }) => {
        const rest = selected.filter((file) => unconvertibleHeic.includes(file.name))
        if (files.length + rest.length > 0) onUpload([...files, ...rest])
      })
    }

  const input = (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={filesAccept}
        className="hidden"
        onChange={handleChange()}
        data-testid="project-upload-input"
      />
      {allowFolders && (
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          className="hidden"
          onChange={handleChange()}
          data-testid="project-upload-folder-input"
        />
      )}
      {photoEntries && photos.available && (
        <>
          <input
            ref={libraryInputRef}
            type="file"
            multiple
            accept={photos.accept}
            className="hidden"
            onChange={handleChange()}
            data-testid="project-upload-library-input"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={photos.accept}
            capture="environment"
            className="hidden"
            onChange={handleChange('camera')}
            data-testid="project-upload-camera-input"
          />
        </>
      )}
    </>
  )

  const typesLabel = acceptedTypes
    .split(',')
    .map((ext) => ext.trim().replace(/^\./, '').toUpperCase())
    .filter(Boolean)
    .join(', ')

  const trigger = (
    <Button
      type="button"
      onClick={allowFolders ? undefined : () => inputRef.current?.click()}
      disabled={isUploading}
      size={size}
      variant={headerInstance && yields ? 'secondary' : variant}
      className={cn('gap-2', compact && 'gap-1 px-2.5')}
      title={compact ? buttonLabel : undefined}
    >
      {isUploading ? <Spinner size="sm" /> : <Upload className="size-4" aria-hidden />}
      <span className={cn((glyphOnly || compact) && 'sr-only')}>{isUploading ? t('upload.uploading') : buttonLabel}</span>
      {allowFolders && !glyphOnly && <ChevronDown className="size-3.5 opacity-70" aria-hidden />}
    </Button>
  )

  if (!allowFolders) {
    return (
      <>
        {input}
        {trigger}
      </>
    )
  }

  return (
    <>
      {input}
      <DropdownMenu>
        <DropdownMenuTrigger asChild data-testid="project-upload-trigger">
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72 max-w-[calc(100vw-2rem)]"
        >
          {photoEntries && (
            <>
              <DropdownMenuItem
                disabled={!photos.available}
                onSelect={() => cameraInputRef.current?.click()}
                data-testid="project-upload-camera-item"
              >
                <Camera className="size-4" aria-hidden />
                <DropdownMenuItemText
                  title={tCapture('attach.takePhoto')}
                  hint={tCapture('photos.folderDestination')}
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!photos.available}
                onSelect={() => libraryInputRef.current?.click()}
                data-testid="project-upload-library-item"
              >
                <Images className="size-4" aria-hidden />
                <DropdownMenuItemText
                  title={tCapture('attach.photoLibrary')}
                  hint={tCapture('attach.photoLibraryHint')}
                />
              </DropdownMenuItem>
              {!photos.available && (
                <p
                  className="text-muted-foreground px-2.5 pb-1.5 pt-0.5 text-xs leading-snug"
                  role="note"
                >
                  {tCapture(
                    photos.reason === 'vlm-unavailable'
                      ? 'photos.unavailableVision'
                      : 'photos.unavailableNotEnabled'
                  )}
                </p>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onSelect={() => inputRef.current?.click()}
            data-testid="project-upload-files-item"
          >
            <Upload className="size-4" aria-hidden />
            {t('upload.uploadFiles')}
          </DropdownMenuItem>
          {/* iOS Safari has no folder picker (`webkitdirectory` opens the plain
              file sheet), so a finger is not offered an entry that cannot work. */}
          {!touch && (
            <DropdownMenuItem
              onSelect={() => folderInputRef.current?.click()}
              data-testid="project-upload-folder-item"
            >
              <FolderUp className="size-4" aria-hidden />
              {t('upload.uploadFolder')}
            </DropdownMenuItem>
          )}
          {headerInstance && newFolder && (
            <DropdownMenuItem onSelect={newFolder} data-testid="project-upload-new-folder">
              <FolderPlus className="size-4" aria-hidden />
              {t('folders.newFolder')}
            </DropdownMenuItem>
          )}
          {onSendByMail && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSendByMail} data-testid="project-upload-send-by-mail">
                <Mail className="size-4" aria-hidden />
                <DropdownMenuItemText title={t('inboundMail.sendByMail')} hint={t('inboundMail.sendByMailHint')} />
              </DropdownMenuItem>
            </>
          )}
          {/* What the grid's dashed „Dateien hierher ziehen“ tile said, where the hand already is: the page takes a drop
              anywhere, and the formats and the limit are what a person asks before they pick. */}
          <DropdownMenuSeparator />
          <p className="text-muted-foreground px-2.5 pb-1.5 pt-1 text-xs leading-snug" role="note" data-testid="project-upload-limits">
            {!touch && <span className="block">{t('uploadZone.dropAnywhere')}</span>}
            {typesLabel} · {t('uploadZone.maxSizeShort', { size: formatBytes(maxFileSize, locale) })}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

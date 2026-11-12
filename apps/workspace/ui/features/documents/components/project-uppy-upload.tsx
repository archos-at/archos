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
  /** Present for project corpus uploads; omitted for the org-wide Archiv. */
  projectId?: string
  folderId?: string | null
  onUpload: (files: File[]) => void
  isUploading: boolean
  /** Visual variant of the trigger. */
  variant?: 'default' | 'secondary'
  size?: 'sm' | 'default'
  label?: string
  /** The glyph alone, its label for a screen reader only (the phone's floating 56px Hochladen). */
  glyphOnly?: boolean
  /**
   * Offer a second trigger that picks a WHOLE FOLDER.
   *
   * A büro onboarding a project moves a directory tree, not a hand-picked list,
   * and the file picker cannot express that at all. Kept as a separate control
   * rather than a mode on this one: an input carrying `webkitdirectory` can
   * ONLY choose folders, so making it the same button would take away the
   * ordinary case to add the bulk one.
   */
  allowFolders?: boolean
  /** Lets a context-menu item click the hidden file input. */
  pickFilesRef?: MutableRefObject<(() => void) | null>
  pickFolderRef?: MutableRefObject<(() => void) | null>
  /**
   * „Per E-Mail senden …“: opens the project's mail address (ADR-0137), a
   * project shelf's only, for a reader who may decide held mail. In this menu
   * because forwarding a mail is one more way of bringing files here.
   */
  onSendByMail?: () => void
}

/**
 * Upload trigger for a durable document corpus. Files selected here are
 * persisted to the target collection (a project's corpus or the org-wide
 * Archiv), not a throwaway chat session. Presentation only — validation and
 * orchestration stay in the useFileUpload hook (the onUpload contract), so
 * `projectId`/`folderId` are unused here and optional.
 */
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
  // The site photo, on a touch screen: the menu leads with the camera and the
  // photo library, and „Dateien hochladen" then offers documents only (with
  // image types in it, iOS would answer with its own Mediathek / Kamera sheet).
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
  // The section tool row's Hochladen (`useInSectionToolRow`; never the empty state's own): its glyph alone on a narrow row, the
  // raised press while an empty level's own Hochladen is the pane's primary, and „Neuer Ordner“ in its menu where the
  // row has no room for that press.
  const tier = useSectionToolTier()
  const yields = useSectionPrimaryYields()
  const newFolder = useSectionNewFolder()
  const headerInstance = useInSectionToolRow() && !glyphOnly
  const compact = headerInstance && tier === 'narrow'
  // Server-computed, flag-gated accept-list and size limit (image types only
  // when the `image-upload` flag allows). Falls back to the static defaults if
  // the AppConfig provider is somehow absent (e.g. isolated tests).
  const fileUpload = useAppConfig().fileUpload
  // A zip is unpacked before it is uploaded, on every durable shelf, so the
  // picker offers it although the accept-list (which the server enforces on the
  // files inside) does not name it.
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
      // A photo gets a name of its own: the filename is the document's
      // identity, and iOS calls every capture `image.jpg` (`site-photo.ts`).
      void prepareSitePhotos(selected, {
        source,
        prefix: tCapture('photos.fileNamePrefix'),
        imagesAccepted: photos.available,
      }).then(({ files, unconvertibleHeic }) => {
        // An unconvertible HEIC goes on under its own name, so the upload's
        // own validation reports it with every other refused file.
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
          // No `accept`: a folder input applies it to the FOLDER, not to the
          // files inside, and the browser then offers nothing at all. What is
          // acceptable is decided by the validator on the way through, which is
          // where the whole rejected/accepted report comes from anyway.
          //
          // Both spellings, and both as strings: `webkitdirectory` is the one
          // every engine implements and `directory` is the standardised name,
          // and React only forwards these to the DOM when they are strings.
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

  // The REAL accepted extensions and limit, prettified („PDF, DOCX, TXT, MD“), as the menu's foot says them.
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

  // ONE CONTROL, TWO SOURCES.
  //
  // Folder upload first shipped as a second button beside this one, and it cost
  // more than it looked: the action row is in a header that shares its width
  // with the section's description, so an extra full-width button squeezed that
  // text into a four-word column. A second button also overstated the feature —
  // picking a folder is the occasional onboarding move, not a peer of the
  // everyday one.
  //
  // It cannot be folded into the same INPUT (one carrying `webkitdirectory` can
  // only choose folders), so the split lives in a menu instead of in the
  // toolbar: same single affordance, and the choice appears only for the reader
  // who wants it.
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

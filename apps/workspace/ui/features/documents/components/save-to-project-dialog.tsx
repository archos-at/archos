'use client'

import type { FormEvent, JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder, FolderPlus } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { validateDocumentName, type DocumentNameError } from '@/lib/documents/display-name'
import { cn } from '@/lib/utils'
import type { FolderItem } from '../file-types'
import { useSaveFolders, type KnownFolders } from '../hooks/use-save-folders'
import { FOLDER_ROW } from './folder-picker-sheet'
import { folderPath } from './folder-trail'
import { ChangeNoteField, SaveModeChoice, type SaveMode } from './save-as-revision'

export interface SaveToProjectChoice {
  folderId: string | null
  folderLabel: string
  name: string
  as?: SaveMode
  changeNote?: string
}

export interface SaveToProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  fileName: string
  extension: string
  title?: string
  initialFolderId?: string | null
  initialFolderName?: string
  locating?: boolean
  revisionOf?: string
  changeNote?: string
  knownFolders?: KnownFolders
  pending?: boolean
  error?: string | null
  onSave: (choice: SaveToProjectChoice) => void | Promise<void>
}

export function nameStem(fileName: string, extension: string): string {
  const suffix = `.${extension}`.toLowerCase()
  const trimmed = fileName.trim()
  return trimmed.toLowerCase().endsWith(suffix) ? trimmed.slice(0, -suffix.length).trimEnd() : trimmed
}

const NAME_ERROR_KEY: Record<DocumentNameError, 'saveTo.nameEmpty' | 'saveTo.nameTooLong' | 'saveTo.nameInvalid'> = {
  empty: 'saveTo.nameEmpty',
  tooLong: 'saveTo.nameTooLong',
  invalidCharacters: 'saveTo.nameInvalid',
}

function mayWrite(folder: FolderItem | undefined, rootAccess: 'read' | 'write'): boolean {
  return folder ? folder.access !== 'read' : rootAccess !== 'read'
}

export function SaveToProjectDialog({
  open,
  onOpenChange,
  projectId,
  fileName,
  extension,
  title,
  initialFolderId = null,
  initialFolderName,
  locating = false,
  revisionOf,
  changeNote: initialChangeNote = '',
  knownFolders,
  pending = false,
  error = null,
  onSave,
}: SaveToProjectDialogProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const { folders, rootAccess, status, load, create } = useSaveFolders(projectId, open, knownFolders)
  const [stem, setStem] = useState(() => nameStem(fileName, extension))
  const [nameError, setNameError] = useState<DocumentNameError | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(initialFolderId)
  const [mode, setMode] = useState<SaveMode>('own')
  const [changeNote, setChangeNote] = useState(initialChangeNote)
  const moved = useRef(false)

  useEffect(() => {
    if (!open) return
    setStem(nameStem(fileName, extension))
    setNameError(null)
    setMode('own')
    setChangeNote(initialChangeNote)
    moved.current = false
  }, [open, fileName, extension, initialChangeNote])

  useEffect(() => {
    if (!open || moved.current) return
    if (initialFolderId !== null) {
      setCurrentId(initialFolderId)
      return
    }
    const named = initialFolderName
      ? folders.find((folder) => (folder.parentId ?? null) === null && folder.name === initialFolderName)
      : undefined
    setCurrentId(named?.id ?? null)
  }, [open, initialFolderId, initialFolderName, folders])

  const moveTo = (folderId: string | null): void => {
    moved.current = true
    setCurrentId(folderId)
  }

  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const here = currentId === null ? undefined : byId.get(currentId)
  const location = status === 'ready' && currentId !== null && !here ? null : currentId
  const trail = useMemo(() => folderPath(folders, location), [folders, location])
  const children = useMemo(
    () =>
      folders
        .filter((folder) => (folder.parentId ?? null) === location)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, location],
  )
  const rootLabel = t('folders.allFiles')
  const hereLabel = here?.name ?? rootLabel
  const writable = mayWrite(here, rootAccess)
  const ready = status === 'ready' && !locating

  const asRevision = revisionOf !== undefined && mode === 'revision'

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (pending) return
    if (asRevision) {
      void onSave({ folderId: null, folderLabel: revisionOf, name: '', as: 'revision', changeNote: changeNote.trim() })
      return
    }
    if (!ready || !writable) return
    const chosenStem = nameStem(stem, extension)
    const validated = validateDocumentName(chosenStem === '' ? '' : `${chosenStem}.${extension}`)
    if (!validated.ok) {
      setNameError(validated.reason)
      return
    }
    const folderLabel = trail.length === 0 ? rootLabel : trail.map((folder) => folder.name).join(' / ')
    void onSave({ folderId: location, folderLabel, name: validated.value, ...(revisionOf !== undefined ? { as: 'own' } : {}) })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[480px]" closeLabel={t('saveTo.close')} data-testid="save-to-project">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="pr-10 text-base leading-snug">{title ?? t('saveTo.title')}</DialogTitle>
            <DialogDescription>
              {asRevision ? t('saveTo.revisionHint', { name: revisionOf }) : t('saveTo.description')}
            </DialogDescription>
          </DialogHeader>

          {revisionOf !== undefined && (
            <SaveModeChoice revisionOf={revisionOf} value={mode} onChange={setMode} disabled={pending} />
          )}

          {asRevision && (
            <ChangeNoteField revisionOf={revisionOf} value={changeNote} onChange={setChangeNote} disabled={pending} />
          )}

          <Field hidden={asRevision}>
            <FieldLabel htmlFor="save-to-project-name">{t('saveTo.name')}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="save-to-project-name"
                value={stem}
                onChange={(event) => {
                  setStem(event.target.value)
                  setNameError(null)
                }}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={pending}
                aria-invalid={nameError !== null}
                aria-describedby={nameError ? 'save-to-project-name-error' : 'save-to-project-name-hint'}
                className="flex-1"
                data-testid="save-to-project-name"
              />
              <span
                className="rounded-inline bg-muted text-muted-foreground shrink-0 px-2 py-1 font-mono text-xs"
                data-testid="save-to-project-extension"
              >
                .{extension}
              </span>
            </div>
            {nameError ? (
              <FieldError id="save-to-project-name-error">{t(NAME_ERROR_KEY[nameError])}</FieldError>
            ) : (
              <FieldDescription id="save-to-project-name-hint">
                {t('saveTo.nameHint', { extension: `.${extension}` })}
              </FieldDescription>
            )}
          </Field>

          <div className="flex min-w-0 flex-col gap-1.5" hidden={asRevision}>
            <span className="text-sm font-medium" id="save-to-project-location">
              {t('saveTo.location')}
            </span>
            <Breadcrumb aria-labelledby="save-to-project-location">
              <BreadcrumbList className="gap-1 sm:gap-1">
                <Crumb label={rootLabel} current={trail.length === 0} onOpen={() => moveTo(null)} />
                {trail.map((folder, index) => (
                  <Crumb
                    key={folder.id}
                    label={folder.name}
                    current={index === trail.length - 1}
                    onOpen={() => moveTo(folder.id)}
                  />
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <FolderLevel
              status={locating ? 'loading' : status}
              hereLabel={hereLabel}
              folders={children}
              disabled={pending}
              onOpen={moveTo}
              onRetry={() => void load()}
            />
            {ready && writable && (
              <NewFolderRow
                disabled={pending}
                parentLabel={hereLabel}
                onCreate={async (name) => {
                  const outcome = await create(name, location)
                  if (outcome.ok) moveTo(outcome.folder.id)
                  return outcome
                }}
              />
            )}
            {ready && !writable && (
              <p className="text-muted-foreground text-sm" data-testid="save-to-project-read-only">
                {t('saveTo.readOnlyHere', { folder: hereLabel })}
              </p>
            )}
          </div>

          {error && (
            <p className="text-destructive text-sm" role="alert" data-testid="save-to-project-error">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('saveTo.cancel')}
            </Button>
            <BusyButton
              type="submit"
              busy={pending}
              blocked={!asRevision && (!ready || !writable)}
              busyLabel={t('saveTo.saving')}
              data-testid="save-to-project-submit"
            >
              {t('saveTo.save')}
            </BusyButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Crumb({ label, current, onOpen }: { label: string; current: boolean; onOpen: () => void }): JSX.Element {
  return (
    <>
      <BreadcrumbItem>
        {current ? (
          <BreadcrumbPage className="font-medium" data-testid="save-to-project-here">
            {label}
          </BreadcrumbPage>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-inline hover:text-foreground focus-visible:ring-ring min-h-8 transition-colors focus-visible:outline-none focus-visible:ring-2"
          >
            {label}
          </button>
        )}
      </BreadcrumbItem>
      {!current && <BreadcrumbSeparator />}
    </>
  )
}

function FolderLevel({
  status,
  hereLabel,
  folders,
  disabled,
  onOpen,
  onRetry,
}: {
  status: 'loading' | 'ready' | 'failed'
  hereLabel: string
  folders: readonly FolderItem[]
  disabled: boolean
  onOpen: (folderId: string) => void
  onRetry: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-1 py-1" aria-busy="true" aria-label={t('saveTo.loading')}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-4/5" />
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-sm" role="alert">
        {t('saveTo.loadError')}
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onRetry}>
          {t('saveTo.retry')}
        </Button>
      </p>
    )
  }
  if (folders.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">{t('saveTo.noSubfolders')}</p>
  }
  return (
    <ul
      className="-mx-2 max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain"
      aria-label={t('saveTo.folders', { folder: hereLabel })}
      data-testid="save-to-project-folders"
    >
      {folders.map((folder) => (
        <li key={folder.id}>
          <button
            type="button"
            className={cn(FOLDER_ROW, 'text-foreground disabled:opacity-50')}
            disabled={disabled}
            aria-label={t('saveTo.openFolder', { name: folder.name })}
            onClick={() => onOpen(folder.id)}
            data-testid={`save-to-project-folder-${folder.id}`}
          >
            <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-words">{folder.name}</span>
            {folder.access === 'read' && (
              <span className="text-muted-foreground shrink-0 text-xs">{t('saveTo.readOnly')}</span>
            )}
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function NewFolderRow({
  disabled,
  parentLabel,
  onCreate,
}: {
  disabled: boolean
  parentLabel: string
  onCreate: (name: string) => Promise<{ ok: true } | { ok: false; nameTaken: boolean }>
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (name === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        disabled={disabled}
        onClick={() => setName('')}
        data-testid="save-to-project-new-folder"
      >
        <FolderPlus aria-hidden />
        {t('saveTo.newFolder')}
      </Button>
    )
  }

  const commit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setFailure(null)
    const outcome = await onCreate(trimmed)
    setBusy(false)
    if (outcome.ok) {
      setName(null)
      return
    }
    setFailure(
      outcome.nameTaken
        ? t('saveTo.folderNameTaken', { name: trimmed, parent: parentLabel })
        : t('saveTo.createFolderError'),
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          aria-label={t('saveTo.newFolderName')}
          placeholder={t('saveTo.newFolderName')}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
            setFailure(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setName(null)
            }
          }}
          className="flex-1"
          data-testid="save-to-project-new-folder-name"
        />
        <BusyButton
          type="button"
          variant="secondary"
          busy={busy}
          blocked={name.trim() === ''}
          busyLabel={t('saveTo.creatingFolder')}
          onClick={() => void commit()}
          data-testid="save-to-project-new-folder-create"
        >
          {t('saveTo.createFolder')}
        </BusyButton>
      </div>
      {failure && <FieldError>{failure}</FieldError>}
    </div>
  )
}

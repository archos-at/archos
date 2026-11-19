'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { FolderInput, Library, Sparkles } from 'lucide-react'
import {
  bulkBaseKnowledge,
  createBaseKnowledgeFolder,
  deleteBaseKnowledgeFolder,
  getBaseKnowledgeEntry,
  listBaseKnowledge,
  renameBaseKnowledgeFolder,
  type BaseKnowledgeEntry,
} from '@/adapters/api/base-knowledge-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-error'
import { BackControl } from '@/components/shell/back-link'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { SECTION_HEADER_CLASS } from '@/components/shell/project-section-frame'
import {
  FileDropOverlay,
  FileGrid,
  FolderBreadcrumbRow,
  FolderCard,
  OFFICE_SHELF_FILES_HREF,
  ShelfUploadControl,
  useFileDragDrop,
  useOfficeShelfDocuments,
  type StoredUpload,
} from '@/features/documents'
import type { FolderItem } from '@/features/documents/file-types'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { filesCopy } from '@/i18n/namespaces/files'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { MAX_BULK_ENTRIES, MAX_RECOGNIZE_DOCUMENTS, type BulkEntriesBody, type PlainUpload } from '@/lib/base-knowledge/wire'
import { useBaseKnowledge, type BaseKnowledgeFilters } from '../hooks/use-base-knowledge'
import { onePlace, useNormRecognition } from '../hooks/use-norm-recognition'
import { NormDialog } from './norm-dialog'
import { EntryList } from './entry-list'
import { EntryPage } from './entry-page'
import { StandardFile } from './standard-file'
import { Guide } from './guide'
import { ShelfPickerDialog } from './shelf-picker-dialog'

export interface BaseKnowledgeWorkspaceProps {
  trailingActions?: ReactNode
  place?: { title: string; crumb: ReactNode; places: ReactNode }
  uploadCollection?: string
}

type Translate = ReturnType<typeof useTranslations>
const failure = (t: Translate, error: unknown) => (error instanceof Error && error.message ? error.message : t('saveError'))

type Place = { folderId?: string | null; entryId?: string | null; fileId?: string | null }

function useLocation(): {
  folderId: string | null
  entryId: string | null
  fileId: string | null
  go: (next: Place, options?: { replace?: boolean }) => void
  back: () => void
} {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const folderId = params.get('folder')
  const entryId = params.get('entry')
  const fileId = params.get('file')
  const go = useCallback(
    (next: Place, options: { replace?: boolean } = {}) => {
      const query = new URLSearchParams(params.toString())
      for (const [key, value] of [['folder', next.folderId], ['entry', next.entryId], ['file', next.fileId]] as const) {
        if (value === undefined) continue
        if (value) query.set(key, value)
        else query.delete(key)
      }
      const search = query.toString()
      const href = search ? `${pathname}?${search}` : pathname
      if (options.replace) router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    },
    [params, pathname, router],
  )
  const back = useCallback(() => router.back(), [router])
  return { folderId, entryId, fileId, go, back }
}

function useOpenEntry(
  entryId: string | null,
  entries: readonly BaseKnowledgeEntry[],
): { entry: BaseKnowledgeEntry | null; failed: boolean; retry: () => void; set: (entry: BaseKnowledgeEntry | null) => void } {
  const [fetched, setFetched] = useState<BaseKnowledgeEntry | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const listed = entryId ? (entries.find((entry) => entry.id === entryId) ?? null) : null
  useEffect(() => {
    if (!entryId || listed || fetched?.id === entryId || failedId === entryId) return
    let cancelled = false
    getBaseKnowledgeEntry(entryId)
      .then((entry) => !cancelled && setFetched(entry))
      .catch(() => !cancelled && setFailedId(entryId))
    return () => {
      cancelled = true
    }
  }, [entryId, listed, fetched?.id, failedId])
  return {
    entry: listed ?? (fetched?.id === entryId ? fetched : null),
    failed: !listed && entryId !== null && failedId === entryId,
    retry: () => setFailedId(null),
    set: setFetched,
  }
}

export function BaseKnowledgeWorkspace({ trailingActions, place, uploadCollection }: BaseKnowledgeWorkspaceProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const location = useLocation()
  const state = useBaseKnowledge({ folderId: location.folderId })
  const { filters, setFilters, list, folders, reload } = state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const canManage = list?.canManage ?? false
  const entries = useMemo(() => list?.entries ?? [], [list])
  const open = useOpenEntry(location.entryId, entries)
  const openEntry = open.entry
  const viewed = useOpenEntry(location.fileId, entries)

  const { go, back } = location
  const openedHere = useRef(false)
  const openFile = useCallback(
    (entryId: string) => {
      if (location.fileId) {
        go({ fileId: entryId }, { replace: true })
        return
      }
      openedHere.current = true
      go({ fileId: entryId })
    },
    [go, location.fileId],
  )
  const closeFile = useCallback(() => {
    if (openedHere.current) back()
    else go({ fileId: null }, { replace: true })
    openedHere.current = false
  }, [back, go])
  useEffect(() => {
    if (!viewed.failed) return
    toast.error(t('entryLoadError'))
    go({ fileId: null }, { replace: true })
  }, [viewed.failed, go, t])

  const hasList = list !== null
  useEffect(() => {
    if (state.failed && hasList) toast.error(t('loadMoreError'))
  }, [state.failed, hasList, t])

  useEffect(() => {
    if (location.folderId !== filters.folderId) setFilters({ folderId: location.folderId })
  }, [location.folderId, filters.folderId, setFilters])

  const tree: FolderItem[] = useMemo(
    () =>
      (folders?.folders ?? []).map((folder) => ({
        ...folder,
        parentId: folder.parentId === folders?.rootId ? null : folder.parentId,
      })),
    [folders],
  )
  const level = tree.filter((folder) => folder.parentId === (filters.folderId ?? null))
  const holds = (folderId: string) =>
    (list?.folderCounts[folderId] ?? 0) + tree.filter((folder) => folder.parentId === folderId).length

  const select = useCallback(
    (ids: string[], on: boolean) => {
      setSelected((current) => {
        const next = new Set(current)
        for (const id of ids) {
          if (on) next.add(id)
          else next.delete(id)
        }
        if (next.size > MAX_BULK_ENTRIES) toast.info(t('bulk.limit', { max: MAX_BULK_ENTRIES }))
        return new Set([...next].slice(0, MAX_BULK_ENTRIES))
      })
    },
    [t],
  )

  const bulk = async (action: BulkEntriesBody['action']) => {
    try {
      const { results } = await bulkBaseKnowledge({ entryIds: [...selected], action })
      const failed = results.filter((result) => !result.ok)
      if (failed.length === 0) toast.success(t('bulk.done', { done: results.length, count: results.length }))
      else toast.warning(t('bulk.partial', { failed: failed.length, count: results.length, reason: failed[0].error ?? '' }))
      setSelected(new Set())
    } catch (error) {
      toast.error(failure(t, error))
    }
    await reload()
  }

  const [adding, setAdding] = useState<{ ids: string[]; total: number }>({ ids: [], total: 0 })
  const startAdding = (ids: string[]) => {
    setAdding({ ids, total: ids.length })
    if (ids.length > 0) go({ entryId: ids[0], fileId: null })
  }
  const addingStep = (entryId: string) =>
    adding.ids.includes(entryId) ? { position: adding.total - adding.ids.length + 1, count: adding.total } : undefined

  const router = useRouter()
  const showPlain = useCallback(
    (plain: readonly PlainUpload[]) => {
      const folderId = onePlace(plain)?.folderId
      router.push(folderId ? `${OFFICE_SHELF_FILES_HREF}?folder=${encodeURIComponent(folderId)}` : OFFICE_SHELF_FILES_HREF)
    },
    [router],
  )
  const norms = useNormRecognition({ showPlain })
  const { recognize } = norms
  const recognizeStored = useCallback(
    (uploads: StoredUpload[]) => void recognize(uploads.map((upload) => upload.documentId), { announcePlain: true }).then(() => reload()),
    [recognize, reload],
  )
  const shelfUpload = useOfficeShelfDocuments({ collectionName: canManage ? uploadCollection : undefined, onStored: recognizeStored })
  const { error: uploadError, clearError: clearUploadError, uploadFiles: uploadToShelf } = shelfUpload
  const uploadFiles = useCallback((files: File[]) => void uploadToShelf(files), [uploadToShelf])
  const drop = useFileDragDrop({ onDrop: uploadFiles, disabled: !canManage })
  const tShelf = useTranslations(officeShelfCopy)
  const tFiles = useTranslations(filesCopy)
  useEffect(() => {
    if (!uploadError) return
    toast.error(uploadError)
    clearUploadError()
  }, [uploadError, clearUploadError])
  const reviewPending = async () => {
    try {
      const pending = await listBaseKnowledge({ attention: 'proposed', limit: MAX_RECOGNIZE_DOCUMENTS })
      await recognize(pending.entries.map((entry) => entry.documentId))
    } catch (error) {
      toast.error(failure(t, error))
    }
  }

  const folderAction = async (action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action()
      await reload()
      return true
    } catch (error) {
      toast.error(failure(t, error))
      return false
    }
  }

  const changeFilters = (patch: Partial<BaseKnowledgeFilters>) => {
    setSelected(new Set())
    setFilters(patch)
  }
  const navigate = (folderId: string | null) => {
    setSelected(new Set())
    location.go({ folderId, entryId: null })
  }

  const headerActions = canManage && (
    <>
      <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
        <FolderInput className="size-4" aria-hidden />
        {t('fromShelf')}
      </Button>
      <ShelfUploadControl onUpload={uploadFiles} isUploading={shelfUpload.isUploading} />
    </>
  )

  const empty = list !== null && list.counts.all === 0 && filters.folderId === null && tree.length === 0

  const body = (): ReactNode => {
    if (state.failed && !list) return <LoadError title={t('loadError')} onRetry={() => reload()} />
    if (!list || !folders) return <Skeleton className="h-64 w-full" />
    if (location.entryId) {
      if (open.failed) {
        return (
          <div className="flex flex-col gap-4">
            <BackControl label={t('detail.back')} onClick={() => location.go({ entryId: null })} className="self-start" testId="base-knowledge-back" />
            <LoadError title={t('entryLoadError')} onRetry={open.retry} />
          </div>
        )
      }
      if (!openEntry) return <Skeleton className="h-64 w-full" />
      return (
        <EntryPage
          entry={openEntry}
          onBack={() => location.go({ entryId: null })}
          onOpenEdition={(entryId) => location.go({ entryId })}
          onOpenFile={() => openFile(openEntry.id)}
          canManage={canManage}
          rootId={folders.rootId}
          folders={folders.folders}
          territories={list.territories}
          adding={addingStep(openEntry.id)}
          onChanged={(entry) => {
            open.set(entry)
            if (adding.ids.includes(openEntry.id) && (!entry || entry.status === 'confirmed')) {
              const rest = adding.ids.filter((id) => id !== openEntry.id)
              setAdding({ ids: rest, total: adding.total })
              location.go({ entryId: rest[0] ?? null }, { replace: true })
            } else if (!entry) location.go({ entryId: null })
            else if (entry.id !== location.entryId) location.go({ entryId: entry.id })
            void reload()
          }}
        />
      )
    }
    if (empty) {
      return (
        <EmptyState
          icon={Library}
          title={t('empty.title')}
          description={canManage ? t('empty.body') : t('empty.readOnly')}
          action={canManage ? <div className="flex flex-wrap justify-center gap-2">{headerActions}</div> : undefined}
          data-testid="base-knowledge-empty"
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <FolderBreadcrumbRow
          folders={tree}
          currentFolderId={filters.folderId}
          onNavigate={navigate}
          rootLabel={t('folders.all')}
          newFolderLabel={t('folders.newTopic')}
          onCreateFolder={
            canManage
              ? (name, parentId) =>
                  folderAction(() => createBaseKnowledgeFolder({ name, ...(parentId ? { parentId } : {}) }))
              : undefined
          }
          itemCount={list.counts.all}
        />
        {level.length > 0 && (
          <FileGrid>
            {level.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                itemCount={holds(folder.id)}
                onOpen={(id) => navigate(id)}
                readOnly={!canManage}
                onRenameFolder={(id, name) => folderAction(() => renameBaseKnowledgeFolder(id, name))}
                onDeleteFolder={(id) => folderAction(() => deleteBaseKnowledgeFolder(id))}
              />
            ))}
          </FileGrid>
        )}
        <EntryList
          list={list}
          folders={folders}
          filters={filters}
          onFilters={changeFilters}
          onReset={state.resetFilters}
          selected={selected}
          onSelect={select}
          onClearSelection={() => setSelected(new Set())}
          onBulk={(action) => (action.type === 'remove' ? setRemoving(true) : void bulk(action))}
          onOpen={(entry) => openFile(entry.id)}
          loadingMore={state.loadingMore}
          onLoadMore={state.loadMore}
        />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...(canManage ? drop.dragHandlers : {})} data-testid="base-knowledge-workspace">
      <FileDropOverlay
        show={canManage && drop.isDragging}
        isUnsupported={drop.isUnsupportedDrag}
        uploadLabel={tShelf('workspace.dropToUpload')}
        unsupportedLabel={tFiles('workspace.dropUnsupported')}
        refusal={drop.refusal}
        testId="base-knowledge-drop-overlay"
      />
      {place ? (
        <div className={SECTION_HEADER_CLASS} data-testid="base-knowledge-header">
          <PageHeader title={place.title} crumb={place.crumb} action={trailingActions} actionInline />
          <div className="-mb-2 mt-6 min-w-0 phone:mt-4">{place.places}</div>
          {headerActions && <div className="mt-4 flex min-w-0 flex-wrap items-center justify-end gap-2">{headerActions}</div>}
        </div>
      ) : (
      <div className={SECTION_HEADER_CLASS} data-testid="base-knowledge-header">
        <div className="flex min-w-0 items-start gap-3 sm:items-end">
          <PageHeader
            className="flex-1"
            title={
              <span className="inline-flex min-w-0 items-center gap-2">
                {t('title')}
                {list && list.counts.all > 0 && filters.folderId === null && <CountPill count={list.counts.all} />}
              </span>
            }
            subtitle={t('subtitle')}
            action={<div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 max-sm:w-full">{headerActions}</div>}
          />
          {trailingActions && <div className="flex shrink-0 items-center">{trailingActions}</div>}
        </div>
      </div>
      )}

      <div className="flex flex-col gap-4 px-4 pb-8 sm:px-6 md:px-8">
        {list && !location.entryId && <Guide key={empty ? 'empty' : 'filled'} defaultOpen={empty} />}
        {canManage && list && !location.entryId && list.counts.proposed > 0 && (
          <Alert variant="info" role="status" data-testid="base-knowledge-pending">
            <Sparkles aria-hidden />
            <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-2 text-foreground">
              <span>{list.counts.proposed === 1 ? t('norms.pendingOne') : t('norms.pending', { count: list.counts.proposed })}</span>
              <Button size="sm" variant="secondary" onClick={() => void reviewPending()} data-testid="base-knowledge-review-pending">
                {t('norms.review')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {body()}
      </div>

      {viewed.entry && (
        <StandardFile
          entry={viewed.entry}
          canManage={canManage}
          onClose={closeFile}
          onManage={() => {
            openedHere.current = false
            go({ fileId: null, entryId: viewed.entry?.id }, { replace: true })
          }}
          onOpenEdition={(entryId) => go({ fileId: entryId }, { replace: true })}
          onChanged={(entry) => {
            viewed.set(entry)
            if (!entry) closeFile()
            void reload()
          }}
          onUnavailable={() => {
            toast.error(t('entryLoadError'))
            closeFile()
          }}
        />
      )}

      <NormDialog
        recognition={norms.recognition}
        onClose={() => {
          norms.close()
          void reload()
        }}
        onSettled={() => {
          norms.close()
          void reload()
        }}
      />
      <ShelfPickerDialog open={picking} onOpenChange={setPicking} recorded={new Set(entries.map((entry) => entry.documentId))} onProposed={(entry) => void reload().then(() => startAdding([entry.id]))} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('bulk.removeTitle', { count: selected.size })}
        description={t('bulk.removeBody')}
        confirmLabel={t('bulk.remove')}
        cancelLabel={t('detail.cancel')}
        onConfirm={() => bulk({ type: 'remove' })}
      />
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Library, Sparkles } from 'lucide-react'
import {
  bulkBaseKnowledge,
  createBaseKnowledgeFolder,
  deleteBaseKnowledgeFolder,
  getBaseKnowledgeEntry,
  listBaseKnowledge,
  renameBaseKnowledgeFolder,
  type BaseKnowledgeEntry,
} from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-error'
import { BackControl } from '@/components/shell/back-link'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { SuggestionPanel } from '@/components/ui/suggestion-panel'
import { SectionPlaceScope } from '@/components/shell/section-place'
import { SectionToolRowScope } from '@/components/shell/section-tool-row'
import {
  FileDropOverlay,
  FileGrid,
  FolderBreadcrumbRow,
  FolderCard,
  NewFolderDialog,
  OfficeShelfHeader,
  ShelfUploadControl,
  UploadFab,
  useFileDragDrop,
  useOfficeShelfDocuments,
  usePhoneLayout,
  type StoredUpload,
} from '@/features/documents'
import type { FolderItem } from '@/features/documents/file-types'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { filesCopy } from '@/i18n/namespaces/files'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { MAX_BULK_ENTRIES, MAX_RECOGNIZE_DOCUMENTS, type BulkEntriesBody } from '@/lib/base-knowledge/wire'
import { cn } from '@/lib/utils'
import { useBaseKnowledge, type BaseKnowledgeFilters } from '../hooks/use-base-knowledge'
import { useNormRecognition } from '../hooks/use-norm-recognition'
import { NormDialog } from './norm-dialog'
import { EntryList } from './entry-list'
import { EntryPage } from './entry-page'
import { StandardFile } from './standard-file'
import { Guide } from './guide'
import { NormsToolRow } from './norms-tool-row'
import { ShelfPickerDialog } from './shelf-picker-dialog'

export interface BaseKnowledgeWorkspaceProps {
  trailingActions?: ReactNode
  organizationName?: string | null
  places?: ReactNode
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

export function BaseKnowledgeWorkspace({ trailingActions, organizationName = null, places, uploadCollection }: BaseKnowledgeWorkspaceProps): JSX.Element {
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


  const norms = useNormRecognition()
  const { recognize } = norms
  const recognizeStored = useCallback(
    (uploads: StoredUpload[]) =>
      void recognize(uploads.map((upload) => upload.documentId), { source: 'office_shelf_upload', announcePlain: true }).then(() => reload()),
    [recognize, reload],
  )
  const shelfUpload = useOfficeShelfDocuments({ collectionName: canManage ? uploadCollection : undefined, asNorm: true, onStored: recognizeStored })
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
      await recognize(pending.entries.map((entry) => entry.documentId), { source: 'review_pending' })
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
    if (location.entryId) location.go({ entryId: null })
  }
  const navigate = (folderId: string | null) => {
    setSelected(new Set())
    location.go({ folderId, entryId: null })
  }

  const phone = usePhoneLayout()
  const empty = list !== null && list.counts.all === 0 && filters.folderId === null && tree.length === 0
  const [guideChoice, setGuideChoice] = useState<boolean | null>(null)
  const guideOpen = guideChoice ?? empty
  const [topicOpen, setTopicOpen] = useState(false)
  const createTopic = (name: string) =>
    folderAction(() => createBaseKnowledgeFolder({ name, ...(filters.folderId ? { parentId: filters.folderId } : {}) }))
  const upload = canManage ? <ShelfUploadControl onUpload={uploadFiles} isUploading={shelfUpload.isUploading} glyphOnly={phone} /> : undefined
  const toolRow = (
    <NormsToolRow
      phone={phone}
      search={filters.search}
      onSearch={(search) => changeFilters({ search })}
      kind={filters.kind}
      onKind={(kind) => changeFilters({ kind })}
      upload={phone ? undefined : upload}
      onFromShelf={canManage ? () => setPicking(true) : undefined}
      onNewTopic={phone && canManage ? () => setTopicOpen(true) : undefined}
      onGuide={() => setGuideChoice(!guideOpen)}
    />
  )

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
          onChanged={(entry) => {
            open.set(entry)
            if (!entry) location.go({ entryId: null })
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
          data-testid="base-knowledge-empty"
        />
      )
    }
    return (
      <div className="flex flex-col gap-8">
        {level.length > 0 && (
          <section aria-label={t('folders.topics')} data-testid="base-knowledge-topics">
            <SectionLabel as="h2" className="mb-1.5 px-0">
              {t('folders.topics')}
            </SectionLabel>
            <FileGrid className="md:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
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
          </section>
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
          labelled={level.length > 0}
        />
      </div>
    )
  }

  const fab = phone ? upload : undefined
  return (
    <SectionPlaceScope root={tShelf('places.norms')}>
      <SectionToolRowScope enabled={!phone}>
    <div className="relative flex h-full min-h-0 flex-col" {...(canManage ? drop.dragHandlers : {})} data-testid="base-knowledge-workspace">
      <FileDropOverlay
        show={canManage && drop.isDragging}
        isUnsupported={drop.isUnsupportedDrag}
        uploadLabel={tShelf('workspace.dropToUpload')}
        unsupportedLabel={tFiles('workspace.dropUnsupported')}
        refusal={drop.refusal}
        testId="base-knowledge-drop-overlay"
      />
      <OfficeShelfHeader controls={toolRow} count={null} phone={phone} trailingActions={trailingActions} organizationName={organizationName} places={places} />
      {list && folders && (
        <FolderBreadcrumbRow
          folders={tree}
          currentFolderId={filters.folderId}
          onNavigate={navigate}
          rootLabel={t('folders.all')}
          newFolderLabel={t('folders.newTopic')}
          onCreateFolder={canManage ? (name, parentId) => folderAction(() => createBaseKnowledgeFolder({ name, ...(parentId ? { parentId } : {}) })) : undefined}
          itemCount={list.counts.all}
          rootToolsElsewhere={phone}
        />
      )}
      <div
        className={cn('scroll-fade-bottom min-h-0 min-w-0 flex-1 overflow-y-auto', fab ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : 'pb-[env(safe-area-inset-bottom)]')}
        data-testid="base-knowledge-scroll"
      >
        {canManage && list && !location.entryId && list.counts.proposed > 0 && (
          <div className={NOTICE_STRIP}>
            <PendingLine count={list.counts.proposed} onReview={() => void reviewPending()} />
          </div>
        )}
        <div className="listing-container flex flex-col gap-8 px-4 pb-8 pt-6 md:px-8">
          {list && !location.entryId && guideOpen && <Guide onClose={() => setGuideChoice(false)} />}
          {body()}
        </div>
      </div>
      {fab && <UploadFab inSheet>{fab}</UploadFab>}
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
          norms.later()
          void reload()
        }}
        onSettled={() => {
          norms.settled()
          void reload()
        }}
      />
      <ShelfPickerDialog open={picking} onOpenChange={setPicking} recorded={new Set(entries.map((entry) => entry.documentId))} onPick={(documentId) => recognize([documentId], { source: 'folder_migration', asNorm: true }).then(() => reload())} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('bulk.removeTitle', { count: selected.size })}
        description={t('bulk.removeBody')}
        confirmLabel={t('bulk.remove')}
        cancelLabel={t('detail.cancel')}
        onConfirm={() => bulk({ type: 'remove' })}
      />
      {phone && canManage && <NewFolderDialog open={topicOpen} onOpenChange={setTopicOpen} onCreate={createTopic} label={t('folders.newTopic')} />}
    </div>
      </SectionToolRowScope>
    </SectionPlaceScope>
  )
}

const NOTICE_STRIP = 'listing-container px-4 pt-3 md:px-8'

function PendingLine({ count, onReview }: { count: number; onReview: () => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <SuggestionPanel role="status" data-testid="base-knowledge-pending">
      <p className="flex min-w-0 items-start gap-2 px-2 py-1 text-xs">
        <Sparkles className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="text-foreground font-medium">{count === 1 ? t('norms.pendingOne') : t('norms.pending', { count })}</span>{' '}
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>{' '}
          <Button variant="inline" className="touch-target whitespace-nowrap" onClick={onReview} data-testid="base-knowledge-review-pending">
            {t('norms.review')}
          </Button>
        </span>
      </p>
    </SuggestionPanel>
  )
}

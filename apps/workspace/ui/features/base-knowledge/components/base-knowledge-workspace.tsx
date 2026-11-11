'use client'

/**
 * Grundlagen des Büros: the office's standards, commentaries and directives as
 * a place of their own (ADR-0163), built like the Dateien it sits beside: the
 * section header, the path row that drills into folders, folder tiles at each
 * level, one control row, and the list. No side panel: a standard opens as a
 * page in place of the list (`?entry=`), and the open folder is in the URL
 * (`?folder=`), so either can be sent to a colleague.
 *
 * What it adds over a file list is what an office standard needs: what needs a
 * person (proposals to confirm, checks due, copies whose text is not read) as
 * filters with their counts, a table that shows edition, status, text use and
 * last check, bulk actions over a selection, and an entry page that explains
 * each decision where it is made. A member without `org:office_shelf:manage`
 * reads all of it and changes nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { FolderInput, Library, Upload } from 'lucide-react'
import {
  bulkBaseKnowledge,
  createBaseKnowledgeFolder,
  deleteBaseKnowledgeFolder,
  getBaseKnowledgeEntry,
  renameBaseKnowledgeFolder,
  uploadBaseKnowledge,
  type BaseKnowledgeEntry,
} from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-error'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { SECTION_HEADER_CLASS } from '@/components/shell/project-section-frame'
import { FileGrid, FolderBreadcrumbRow, FolderCard } from '@/features/documents'
import type { FolderItem } from '@/features/documents/file-types'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { MAX_BULK_ENTRIES, type BulkEntriesBody } from '@/lib/base-knowledge/wire'
import { useBaseKnowledge, type BaseKnowledgeFilters } from '../hooks/use-base-knowledge'
import { EntryList } from './entry-list'
import { EntryPage } from './entry-page'
import { Guide } from './guide'
import { ShelfPickerDialog } from './shelf-picker-dialog'

export interface BaseKnowledgeWorkspaceProps {
  /** Controls after the header's own, such as the sheet's close. */
  trailingActions?: ReactNode
}

type Translate = ReturnType<typeof useTranslations>
const failure = (t: Translate, error: unknown) => (error instanceof Error && error.message ? error.message : t('saveError'))

/** The folder and the open standard live in the URL, so the back button and a shared link land where the person was. */
function useLocation(): { folderId: string | null; entryId: string | null; go: (next: { folderId?: string | null; entryId?: string | null }) => void } {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const folderId = params.get('folder')
  const entryId = params.get('entry')
  const go = useCallback(
    (next: { folderId?: string | null; entryId?: string | null }) => {
      const query = new URLSearchParams(params.toString())
      for (const [key, value] of [['folder', next.folderId], ['entry', next.entryId]] as const) {
        if (value === undefined) continue
        if (value) query.set(key, value)
        else query.delete(key)
      }
      const search = query.toString()
      router.push(search ? `${pathname}?${search}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )
  return { folderId, entryId, go }
}

/** The open standard: from the page on screen, else read by id (a link sent by a colleague). */
function useOpenEntry(entryId: string | null, entries: readonly BaseKnowledgeEntry[]): [BaseKnowledgeEntry | null, (entry: BaseKnowledgeEntry | null) => void] {
  const [fetched, setFetched] = useState<BaseKnowledgeEntry | null>(null)
  const listed = entryId ? (entries.find((entry) => entry.id === entryId) ?? null) : null
  useEffect(() => {
    if (!entryId || listed || fetched?.id === entryId) return
    let cancelled = false
    getBaseKnowledgeEntry(entryId)
      .then((entry) => !cancelled && setFetched(entry))
      .catch(() => !cancelled && setFetched(null))
    return () => {
      cancelled = true
    }
  }, [entryId, listed, fetched?.id])
  return [listed ?? (fetched?.id === entryId ? fetched : null), setFetched]
}

export function BaseKnowledgeWorkspace({ trailingActions }: BaseKnowledgeWorkspaceProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const location = useLocation()
  const state = useBaseKnowledge({ folderId: location.folderId })
  const { filters, setFilters, list, folders, reload } = state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canManage = list?.canManage ?? false
  const entries = useMemo(() => list?.entries ?? [], [list])
  const [openEntry, setOpenEntry] = useOpenEntry(location.entryId, entries)

  // The URL leads; the filters follow a back or forward step.
  useEffect(() => {
    if (location.folderId !== filters.folderId) setFilters({ folderId: location.folderId })
  }, [location.folderId, filters.folderId, setFilters])

  /** The tree as Dateien draws it: the standards root is the top, so its children have no parent. */
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

  // The files are the browser's own bytes, sent one after another into the open folder.
  const upload = async (files: File[]) => {
    setUploading(true)
    let done = 0
    for (const file of files) {
      try {
        await uploadBaseKnowledge(file, filters.folderId)
        done += 1
      } catch (error) {
        toast.error(error instanceof Error && error.message ? `${file.name}: ${error.message}` : t('uploadFailed', { name: file.name }))
      }
    }
    setUploading(false)
    if (done > 0) toast.success(t('uploadDone', { count: done }))
    await reload()
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
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="base-knowledge-file-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) void upload(files)
        }}
      />
      <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
        <FolderInput className="size-4" aria-hidden />
        {t('fromShelf')}
      </Button>
      <Button size="sm" disabled={uploading} onClick={() => fileInput.current?.click()} data-testid="base-knowledge-upload">
        <Upload className="size-4" aria-hidden />
        {uploading ? t('uploading') : t('upload')}
      </Button>
    </>
  )

  const empty = list !== null && list.counts.all === 0 && filters.folderId === null && tree.length === 0

  const body = (): ReactNode => {
    if (state.failed && !list) return <LoadError title={t('loadError')} onRetry={() => reload()} />
    if (!list || !folders) return <Skeleton className="h-64 w-full" />
    if (location.entryId) {
      if (!openEntry) return <Skeleton className="h-64 w-full" />
      return (
        <EntryPage
          entry={openEntry}
          onBack={() => location.go({ entryId: null })}
          onOpenEdition={(entryId) => location.go({ entryId })}
          canManage={canManage}
          rootId={folders.rootId}
          folders={folders.folders}
          territories={list.territories}
          onChanged={(entry) => {
            setOpenEntry(entry)
            if (!entry) location.go({ entryId: null })
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
          onOpen={(entry) => location.go({ entryId: entry.id })}
          loadingMore={state.loadingMore}
          onLoadMore={state.loadMore}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="base-knowledge-workspace">
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

      <div className="flex flex-col gap-4 px-4 pb-8 sm:px-6 md:px-8">
        {list && !location.entryId && <Guide key={empty ? 'empty' : 'filled'} defaultOpen={empty} />}
        {body()}
      </div>

      <ShelfPickerDialog open={picking} onOpenChange={setPicking} recorded={new Set(entries.map((entry) => entry.documentId))} onProposed={() => void reload()} />
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

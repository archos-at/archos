'use client'

/**
 * A project's Papierkorb (ADR-0088): the folders deleted in it and the
 * documents sent there on their own, who deleted each and when, when its purge
 * runs, and what the reader may do — restore (a folder with its access, its
 * subfolders and documents; a document to the folder it came from), and
 * „Endgültig löschen" for project admins.
 *
 * Only folders the reader may read are listed; the server filters, and checks
 * every action again.
 */

import { fileExtensionLabel } from '../document-kind'
import { useCallback, useState, type JSX } from 'react'
import { AlertTriangle, Folder, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  FolderBinRequestError,
  listFolderBin,
  purgeFolderNow,
  restoreDocument,
  restoreFolder,
  type FolderBinEntry,
  type FolderBinListing,
} from '@/adapters/api/folder-bin-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CLAUSE_JOIN, formatCalendarDate } from '@/lib/format'
import { FOLDER_NAME_TAKEN_REASON } from '@/lib/projects/folder-bin-codes'

export interface FolderBinPanelProps {
  projectId: string
  /** The listing the page read on the server; the panel re-reads after every action. */
  initial: FolderBinListing | null
}

export function FolderBinPanel({ projectId, initial }: FolderBinPanelProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [listing, setListing] = useState<FolderBinListing | null>(initial)
  const [loadFailed, setLoadFailed] = useState(initial === null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purging, setPurging] = useState<FolderBinEntry | null>(null)

  const date = (iso: string): string => formatCalendarDate(iso, locale)

  const [loadingMore, setLoadingMore] = useState(false)

  const reload = useCallback(async () => {
    try {
      setListing(await listFolderBin(projectId))
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [projectId])

  const loadMore = async (): Promise<void> => {
    if (!listing?.nextCursor) return
    setLoadingMore(true)
    try {
      const next = await listFolderBin(projectId, listing.nextCursor)
      setListing({ ...next, entries: [...listing.entries, ...next.entries] })
    } catch {
      toast.error(t('bin.loadError'))
    } finally {
      setLoadingMore(false)
    }
  }

  const restore = async (entry: FolderBinEntry): Promise<void> => {
    setBusyId(entry.folderId)
    try {
      // A document binned on its own goes back to its folder, not as a folder of its own.
      const restored = entry.document
        ? await restoreDocument(entry.document.id)
        : await restoreFolder(projectId, entry.folderId)
      toast.success(
        restored.restoredTo === 'root'
          ? t('bin.restoredToRoot', { name: entry.name })
          : t('bin.restored', { name: entry.name })
      )
      await reload()
    } catch (error) {
      const reason = error instanceof FolderBinRequestError ? error.reason : null
      toast.error(
        reason === FOLDER_NAME_TAKEN_REASON
          ? t('bin.restoreNameTaken', { name: entry.name })
          : reason === 'folder-read-only'
            ? t('bin.restoreReadOnly')
            : t('bin.restoreError')
      )
    } finally {
      setBusyId(null)
    }
  }

  const purge = async (): Promise<void> => {
    if (!purging) return
    const entry = purging
    try {
      await purgeFolderNow(projectId, entry.folderId)
      toast.success(t('bin.purged', { name: entry.name }))
      await reload()
    } catch (error) {
      const held = error instanceof FolderBinRequestError && error.reason === 'legal_hold'
      toast.error(held ? t('bin.held') : t('bin.purgeError'))
      throw error
    }
  }


  if (loadFailed || !listing) {
    return (
      <div className={BIN_PAGE}>
        <EmptyState
          variant="bare"
          icon={AlertTriangle}
          tone="destructive"
          title={t('bin.loadError')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              <RefreshCw className="size-3.5" aria-hidden />
              {t('bin.retry')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className={BIN_PAGE} data-testid="folder-bin">
      {listing.entries.length === 0 ? (
        <EmptyState variant="bare" icon={Trash2} title={t('bin.empty')} description={t('bin.emptyHint')} />
      ) : (
        // Rows on the page, no box and no hairlines; they bleed by their inset so the glyphs stand on the edge.
        <ul className="-mx-4 flex flex-col gap-1">
          {listing.entries.map((entry) => (
            // On a phone the actions take their own line under the entry,
            // rather than squeezing its name and dates to nothing.
            <Item key={entry.folderId} as="li" className="flex-wrap rounded-surface hover:bg-muted sm:flex-nowrap" data-testid={`bin-entry-${entry.folderId}`}>
              {/* The list's 32px column: a document's format in words, as the file list writes it, a folder's glyph. */}
              <ItemMedia className="h-5 w-8 justify-start self-start" /* on the edge and on the name's line */>
                {entry.document ? (
                  <span className="text-muted-foreground text-[11px] font-medium uppercase" aria-hidden>
                    {fileExtensionLabel(entry.name) || '—'}
                  </span>
                ) : (
                  <Folder className="text-muted-foreground size-4" aria-hidden />
                )}
              </ItemMedia>
              <ItemContent className="basis-[calc(100%-2.75rem)] sm:basis-auto">
                <ItemTitle title={entry.path} className="text-[13px]">{entry.name}</ItemTitle>
                {/* What a folder holds first: the figure that says whether it is the one to bring back. A document's
                    glyph says what it is, so it has no such line. */}
                {!entry.document && (
                  <ItemDescription className="whitespace-normal sm:truncate">
                    {[
                      entry.documents > 0 && t('bin.contentsDocuments', { count: entry.documents }),
                      entry.folders > 0 && t('bin.contentsFolders', { count: entry.folders }),
                    ]
                      .filter(Boolean)
                      .join(CLAUSE_JOIN) || t('bin.contentsDocuments', { count: 0 })}
                  </ItemDescription>
                )}
                {/* Who deleted it and when it goes, on one line: four lines of 12px meta per row was a form, not a list. */}
                <ItemDescription className="whitespace-normal text-pretty sm:truncate">
                  <span>
                    {entry.deletedBy.name
                      ? t('bin.deletedBy', { name: entry.deletedBy.name, date: date(entry.deletedAt) })
                      : t('bin.deletedOn', { date: date(entry.deletedAt) })}
                    {/* On a phone when it goes is a line of its own, with no dot to strand at a wrap. */}
                    <span className="max-sm:hidden">{CLAUSE_JOIN}</span>
                    <span className="max-sm:block max-sm:first-letter:uppercase">
                      {entry.status === 'purging'
                        ? t('bin.purging')
                        : entry.status === 'failed'
                          ? t('bin.failed')
                          : t('bin.purgeOn', { date: date(entry.purgeAfter) })}
                    </span>
                    {/* Inline after the words, on a phone too, so the line keeps its edge with the ones above. */}
                    {entry.status === 'purging' && <Spinner size="xs" className="ml-1 inline-block align-[-2px]" />}
                  </span>
                </ItemDescription>
              </ItemContent>
              {/* Restore at the start of the row, „Endgültig löschen" at the far
                  end of it: the destructive action has the width of the row
                  between it and the one a thumb reaches for. It used to sit 23px
                  from Wiederherstellen. `ml-auto` keeps it at the end when it is
                  the only action, so the row does not change shape. */}
              {/* On a phone the actions line up under the name they belong to, not under the glyph. */}
              <ItemActions className="w-full items-center justify-between gap-3 pl-11 sm:w-auto sm:justify-end sm:pl-0" /* one row on a phone: the reason or the press left, the delete right */>
                {/* Where the press would be, the reason it is not: a hole in the press column was a question. */}
                {!entry.canRestore && entry.restoreBlocked && (
                  <span className="text-muted-foreground min-w-0 flex-1 text-xs sm:max-w-56 sm:flex-none sm:text-right" data-testid={`bin-blocked-${entry.folderId}`}>
                    {t(`bin.restoreBlocked.${entry.restoreBlocked}`)}
                  </span>
                )}
                {entry.canRestore && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyId === entry.folderId}
                    onClick={() => void restore(entry)}
                    data-testid={`bin-restore-${entry.folderId}`}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t('bin.restore')}
                  </Button>
                )}
                {listing.canPurge && entry.status !== 'purging' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    // Ink, as every press in the row: five red words led the page, and red is for a failure. The
                    // confirm dialog says what cannot be undone. Its words end on the edge.
                    className="ml-auto -mr-3.5"
                    onClick={() => setPurging(entry)}
                    data-testid={`bin-purge-${entry.folderId}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t('bin.purge')}
                  </Button>
                )}
              </ItemActions>
            </Item>
          ))}
        </ul>
      )}
      {listing.nextCursor && (
        <Button variant="secondary" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMore()}>
          {t('bin.loadMore')}
        </Button>
      )}

      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => (open ? undefined : setPurging(null))}
        title={t('bin.purgeTitle', { name: purging?.name ?? '' })}
        description={t('bin.purgeDescription', { documents: purging?.documents ?? 0 })}
        confirmLabel={t('bin.purge')}
        cancelLabel={t('bin.cancel')}
        onConfirm={purge}
        confirmTestId="bin-purge-confirm"
      />
    </div>
  )
}

/** The listing's container and edges (1280px, 32px; 16px on a phone), as every Dateien tab keeps them. */
const BIN_PAGE = 'flex listing-container flex-col gap-6 px-4 pb-4 md:px-8' // starts under the tabs, as every tab

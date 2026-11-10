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
import { AlertTriangle, Folder, MoreHorizontal, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
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
import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { ROW_HAIRLINE, ROW_REVEAL } from '@/components/ui/row-hairline'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { useLocale, useTranslations, type Translator } from '@/i18n'
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
        // Rows on the page, no box, a hairline between two; they bleed by their inset so the glyphs stand on the edge.
        // 880px of text at most: across the 1216px column the restore press stood a screen's width from the name.
        <ul className="-mx-4 flex max-w-[calc(880px+2rem)] flex-col">
          {listing.entries.map((entry) => {
            const meta = binMetaLine(entry, t, date)
            return (
              // A row is a name and one meta line, 56px (paper on a desk: never three lines at desk width). The one
              // visible action stands on the column's right edge, a raised press; on a phone it is a 44px glyph on the
              // name's line.
              <Item key={entry.folderId} as="li" className={`group/row items-center gap-3 rounded-surface py-2.5 hover:bg-desk [--row-end:16px] [--row-text:60px] ${ROW_HAIRLINE}`} /* the line from the name (16px inset, 32px column, 12px gap) */ data-testid={`bin-entry-${entry.folderId}`}>
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
                <ItemContent>
                  <ItemTitle title={entry.path} className="text-name">{entry.name}</ItemTitle>
                  {/* What it holds, who deleted it and when it goes, on one line: three lines of meta per row was a form.
                      What stays is the line's point, in ink at 500. On a phone the line is two fixed ones (below). */}
                  <ItemDescription className="text-meta truncate first-letter:uppercase max-sm:hidden" title={meta.text} data-testid={`bin-meta-${entry.folderId}`}>
                    {meta.lead}
                    {CLAUSE_JOIN}
                    {/* Before its clause („◌ wird gerade …“). */}
                    {entry.status === 'purging' && <Spinner size="xs" className="mr-1 inline-block align-[-2px]" />}
                    <span className="text-foreground font-medium">{meta.fate}</span>
                  </ItemDescription>
                  {/* A phone's row is 72px: what it holds, then what stays and who deleted it (or why it cannot come
                      back), each one line that breaks only between clauses. Round 3 wrapped one long line into three
                      with a „·“ left at a line's end. */}
                  {meta.phone.map((line, index) => (
                    <ItemDescription key={index} className="text-meta truncate first-letter:uppercase sm:hidden" title={meta.text} data-testid={`bin-meta-phone-${entry.folderId}`}>
                      {index === 1 && entry.status === 'purging' && <Spinner size="xs" className="mr-1 inline-block align-[-2px]" />}
                      {index === 1 ? <span className="text-foreground font-medium">{line[0]}</span> : line[0]}
                      {line.slice(1).map((clause) => `${CLAUSE_JOIN}${clause}`).join('')}
                    </ItemDescription>
                  ))}
                </ItemContent>
                <ItemActions className="gap-1">
                  {/* One visible action per row; the one that destroys sits behind the ⋯ (hover, focus, a coarse pointer),
                      left of the press so the press keeps the column's edge. */}
                  {listing.canPurge && entry.status !== 'purging' && (
                    <ActionMenu
                      mode="dropdown"
                      align="end"
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`text-muted-foreground size-8 pointer-coarse:size-11 ${ROW_REVEAL}`}
                          aria-label={t('bin.purge')}
                          data-testid={`bin-actions-${entry.folderId}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      }
                      entries={[
                        {
                          type: 'item',
                          id: 'purge',
                          label: t('bin.purge'),
                          icon: Trash2,
                          variant: 'destructive',
                          testId: `bin-purge-${entry.folderId}`,
                          onSelect: () => setPurging(entry),
                        },
                      ]}
                    />
                  )}
                  {/* Where the press would be, the reason it is not, in one muted line: a hole in the press column was a question. */}
                  {!entry.canRestore && entry.restoreBlocked && (
                    <span className="text-muted-foreground text-meta max-sm:hidden whitespace-nowrap" data-testid={`bin-blocked-${entry.folderId}`}>
                      {t(`bin.restoreBlocked.${entry.restoreBlocked}`)}
                    </span>
                  )}
                  {/* Every row offers the same action, so at rest it is a ghost glyph and the labelled press comes
                      under the pointer and on focus (principle 6): five „Wiederherstellen“ in a column was round 3. A
                      coarse pointer keeps the 44px glyph. */}
                  {entry.canRestore && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={RESTORE_PRESS}
                      aria-label={t('bin.restore')}
                      disabled={busyId === entry.folderId}
                      onClick={() => void restore(entry)}
                      data-testid={`bin-restore-${entry.folderId}`}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      <span className="sr-only pointer-fine:group-hover/row:not-sr-only pointer-fine:group-focus-within/row:not-sr-only">{t('bin.restore')}</span>
                    </Button>
                  )}
                </ItemActions>
              </Item>
            )
          })}
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

/**
 * A row's one meta line: what a folder holds (a document's format column already says what it is), who deleted it and
 * when, and when it goes or what is happening to it. Lower case after the first clause; the row capitalises its first
 * letter.
 */
function binMetaLine(
  entry: FolderBinEntry,
  t: Translator,
  date: (iso: string) => string,
): { text: string; lead: string; fate: string; phone: string[][] } {
  const contents = entry.document
    ? null
    : [
        entry.documents > 0 && t('bin.contentsDocuments', { count: entry.documents }),
        entry.folders > 0 && t('bin.contentsFolders', { count: entry.folders }),
      ]
        .filter(Boolean)
        .join(CLAUSE_JOIN) || t('bin.contentsDocuments', { count: 0 })
  const deleted = entry.deletedBy.name
    ? t('bin.deletedBy', { name: entry.deletedBy.name, date: date(entry.deletedAt) })
    : t('bin.deletedOn', { date: date(entry.deletedAt) })
  const fate =
    entry.status === 'purging' ? t('bin.purging') : entry.status === 'failed' ? t('bin.failed') : t('bin.purgeOn', { date: date(entry.purgeAfter) })
  const lead = [contents, deleted].filter(Boolean).join(CLAUSE_JOIN)
  // A phone's two lines: what it holds (a document: when it was deleted), then what stays and by whom, or why it
  // cannot come back.
  const blocked = !entry.canRestore && entry.restoreBlocked ? t(`bin.restoreBlockedShort.${entry.restoreBlocked}`) : null
  const phone = [
    [contents ?? t('bin.deletedOn', { date: date(entry.deletedAt) })],
    [fate, blocked ?? entry.deletedBy.name].filter((clause): clause is string => Boolean(clause)),
  ]
  return { text: `${lead}${CLAUSE_JOIN}${fate}`, lead, fate, phone }
}

/**
 * The restore press: on a fine pointer a ghost glyph at rest (no fill, no edge, muted), the raised labelled press while
 * its row is hovered or holds focus; on a coarse pointer the 44px glyph with its edge, as there is no hover.
 */
const RESTORE_PRESS =
  'pointer-coarse:size-11 pointer-coarse:px-0 pointer-fine:w-8 pointer-fine:px-0 pointer-fine:text-muted-foreground pointer-fine:shadow-none pointer-fine:bg-transparent pointer-fine:group-hover/row:w-auto pointer-fine:group-hover/row:px-3.5 pointer-fine:group-hover/row:text-foreground pointer-fine:group-hover/row:bg-sheet pointer-fine:group-hover/row:shadow-press pointer-fine:group-focus-within/row:w-auto pointer-fine:group-focus-within/row:px-3.5 pointer-fine:group-focus-within/row:text-foreground pointer-fine:group-focus-within/row:bg-sheet pointer-fine:group-focus-within/row:shadow-press dark:pointer-fine:group-hover/row:bg-transparent dark:pointer-fine:group-focus-within/row:bg-transparent'


/** The listing's container and edges (1280px, 32px; 16px on a phone), as every Dateien tab keeps them. */
const BIN_PAGE = 'flex listing-container flex-col gap-6 px-4 pb-4 md:px-8' // starts under the tabs, as every tab

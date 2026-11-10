'use client'

import type { JSX } from 'react'
import { motionEntrance } from '@/components/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { FileGrid, FileCardSkeleton } from './file-grid'
import { FileListSkeleton } from './file-list-view'
import { FolderCardSkeleton, FolderRowSkeleton } from './folder-navigation'

/**
 * The listing's width cap (a 4K monitor would stretch cards into a wall), on
 * the section header's edges: the design system's 1280px container with its
 * 32px margins, which the header keeps too. Centred, the page had three left edges.
 */
export const CONTENT_MAX = 'listing-container md:px-8'

/**
 * ENTERING A FOLDER IS AN ARRIVAL, NOT A HANDOVER.
 *
 * This was an `AnimatePresence mode="wait"`, and `wait` means exactly what it
 * says: the level you are leaving plays its exit to completion, and only then
 * does the level you asked for begin to appear. Two 180ms tweens end to end,
 * with a frame in the middle where the pane holds nothing and collapses to the
 * height of its own padding — on the gesture this page is built around, and one
 * a person repeats a dozen times walking a tree.
 *
 * Nothing needed the outgoing level to be watched on its way out. Dropping the
 * presence wrapper makes the swap instant and leaves the arrival, which is the
 * half that carries the direction: the new level slides in from the side it
 * came from, in one 240ms entrance, over content that is already there.
 *
 * `initial: false` when the direction is 0 — no navigation happened, so this is
 * the first paint (which, since the page now server-renders its listing, is a
 * real listing that must not slide) or a re-render the key did not change.
 */
export const levelTransition = (direction: number, distance: number) =>
  ({
    initial: direction === 0 ? false : { opacity: 0, x: direction * distance },
    animate: { opacity: 1, x: 0 },
    transition: motionEntrance,
  }) as const

/**
 * THE FIRST FRAME, SHAPED LIKE THE SECOND ONE.
 *
 * This is the placeholder the whole pane renders while the listing is being
 * read, and it lives beside the listing rather than in a components-of-loading
 * file, because the failure it fixes is drift: the old skeleton drew a
 * full-width `h-9` bar — a search field that had moved into the page header a
 * release earlier and was never coming back — over a full-width grid, and then
 * the answer arrived as a breadcrumb row above a 1200px column of folder tiles
 * and cards. Nothing about the loading state predicted the loaded one, so every
 * load ended in a jump.
 *
 * What it mirrors, in the order the real pane renders them:
 *
 *   - the breadcrumb row, at its real height, when this surface has folders;
 *   - the content cap, so the grid does not start full-width and then narrow;
 *   - the „Zuletzt hochgeladen" eyebrow, which is always there at the root;
 *   - folder tiles BEFORE file tiles, which is the order the grid fills in.
 *
 * It cannot know how many of each are coming. It draws a plausible few — the
 * point of a skeleton is the shape of the page, not a forecast of its contents.
 */
export function FileBrowserSkeleton({
  view = 'cards',
  withFolders = false,
  /** Placeholder folder tiles. Two: enough to read as "folders come first". */
  folders = 2,
  files = 6,
}: {
  view?: 'cards' | 'list'
  withFolders?: boolean
  folders?: number
  files?: number
}): JSX.Element {
  const folderCount = withFolders ? folders : 0
  return (
    <div className="flex h-full flex-col" data-testid="file-browser-skeleton">
      {/* No path row: at the root its tools stand beside the tabs (or in a phone's ⋯), so a placeholder row was a promise
          of a row that never arrives. */}
      {view === 'list' ? (
        <div className={CONTENT_MAX}>
          {folderCount > 0 && (
            <div className="flex flex-col px-2 pb-2 pt-1 md:-mx-2 md:px-0">
              {Array.from({ length: folderCount }).map((_, index) => (
                <FolderRowSkeleton key={index} />
              ))}
            </div>
          )}
          <FileListSkeleton rows={files} />
        </div>
      ) : (
        <div className={`${CONTENT_MAX} px-4 pb-4 pt-1`} /* the grid's own start, as the level draws it */>
          <FileGrid>
            {Array.from({ length: folderCount }).map((_, index) => (
              <FolderCardSkeleton key={`folder-${index}`} />
            ))}
            {/* Where the real label falls: after the folders, heading the files. */}
            <Skeleton className="col-span-full mx-1.5 mt-1 h-3 w-36" />
            {Array.from({ length: files }).map((_, index) => (
              <FileCardSkeleton key={`file-${index}`} />
            ))}
          </FileGrid>
        </div>
      )}
    </div>
  )
}

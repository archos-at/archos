'use client'

import type { JSX } from 'react'
import { motionEntrance } from '@/components/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { FileGrid, FileCardSkeleton } from './file-grid'
import { FileListSkeleton } from './file-list-view'
import { FolderCardSkeleton, FolderRowSkeleton } from './folder-navigation'

export const CONTENT_MAX = 'listing-container md:px-8'

export const levelTransition = (direction: number, distance: number) =>
  ({
    initial: direction === 0 ? false : { opacity: 0, x: direction * distance },
    animate: { opacity: 1, x: 0 },
    transition: motionEntrance,
  }) as const

export function FileBrowserSkeleton({
  view = 'cards',
  withFolders = false,
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

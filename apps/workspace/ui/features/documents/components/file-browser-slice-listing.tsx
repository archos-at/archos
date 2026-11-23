'use client'

import { Fragment, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem } from '../file-types'
import type { BriefSlice, FileBrowserSelection } from '../lib/file-browser-contract'
import type { FileSort } from '../lib/file-sort'
import { CONTENT_MAX } from './file-browser-skeleton'
import type { FileCardRenderer } from './file-browser-tile'
import { FileGrid, FileCardSkeleton } from './file-grid'
import { FileListSkeleton, FileListView } from './file-list-view'

interface BriefSliceListingProps {
  slice: BriefSlice
  orderedSlice: FileItem[]
  view: 'cards' | 'list'
  sort: FileSort
  onSortChange?: (next: FileSort) => void
  selectedFileId: string | null
  onSelectFile: (id: string | null) => void
  renderActions?: (file: FileItem) => ReactNode
  wrapFileRow?: (file: FileItem, row: ReactNode) => ReactNode
  selection?: FileBrowserSelection
  fileCard: FileCardRenderer
}

export function BriefSliceListing({
  slice,
  orderedSlice,
  view,
  sort,
  onSortChange,
  selectedFileId,
  onSelectFile,
  renderActions,
  wrapFileRow,
  selection,
  fileCard,
}: BriefSliceListingProps): ReactNode {
  const t = useTranslations(filesCopy)
  return (
    <div className={CONTENT_MAX} data-testid="folder-brief-slice">
      <div className="flex items-center gap-2 px-4 pt-4">
        <p className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{slice.label}</p>
        <Button type="button" variant="secondary" size="sm" onClick={slice.onClear} data-testid="folder-brief-slice-clear">
          {t('brief.sliceClear')}
        </Button>
      </div>
      {slice.loading ? (
        view === 'list' ? (
          <FileListSkeleton />
        ) : (
          <div className="p-4">
            <FileGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <FileCardSkeleton key={i} />
              ))}
            </FileGrid>
          </div>
        )
      ) : slice.files.length === 0 ? (
        <div className="p-8">
          <EmptyState variant="bare" icon={FolderOpen} title={t('brief.sliceEmpty')} />
        </div>
      ) : view === 'list' ? (
        <FileListView
          files={orderedSlice}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
          wrapRow={wrapFileRow}
          sort={sort}
          onSortChange={onSortChange}
          selection={selection}
        />
      ) : (
        <div className="p-4">
          <FileGrid>
            {orderedSlice.map((file) => (
              <Fragment key={file.id}>{fileCard(file)}</Fragment>
            ))}
          </FileGrid>
        </div>
      )}
    </div>
  )
}

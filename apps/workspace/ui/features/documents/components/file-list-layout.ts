import { createContext } from 'react'
import type { FileListColumns } from './file-list-columns'

/**
 * Dense explorer cells — a 40px row (paper on a desk: 32px content, 4px above and below). Under a finger the row is
 * the target: a name and its summary make it 56px (a phone's row), and a folder's open button is 48px.
 */
export const FILE_LIST_CELL = 'px-2 py-1'

/** Which columns the table draws, for a row it does not render itself (a folder's): its cells follow the head's. */
export interface FileListLayout {
  picking: boolean
  showRank: boolean
  columns: FileListColumns
  actions: boolean
}
export const FileListLayoutContext = createContext<FileListLayout>({
  picking: false,
  showRank: false,
  columns: { approval: false, pages: false, size: true },
  actions: true,
})

/** The date column's cells: dates left-align, as their head does; numbers right-align. */
export const FILE_LIST_DATE_CELL = 'hidden whitespace-nowrap text-left text-xs text-muted-foreground tabular-nums @4xl/filelist:table-cell'
/** The size column's cells, which a folder fills with what it holds. */
export const FILE_LIST_SIZE_CELL = 'hidden whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @3xl/filelist:table-cell'

import { createContext } from 'react'
import type { FileListColumns } from './file-list-columns'

export const FILE_LIST_CELL = 'px-2 py-1'

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

export const FILE_LIST_META_LINE = 'text-meta text-muted-foreground block truncate font-normal tabular-nums @xl/filelist:hidden'

export const FILE_LIST_DATE_CELL = 'hidden whitespace-nowrap text-left text-xs text-muted-foreground tabular-nums @2xl/filelist:table-cell'
export const FILE_LIST_SIZE_CELL = 'hidden whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @xl/filelist:table-cell'

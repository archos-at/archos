'use client'

import { memo, useCallback, type ReactNode } from 'react'
import type { FileItem } from '../file-types'
import { FileCard, type FileCardProps } from './file-card'
import { AssignmentFaces } from './assignment-faces'

export type FileCardRenderer = (
  file: FileItem,
  extra?: { match?: FileCardProps['match']; where?: string }
) => ReactNode

interface FileTileProps {
  file: FileItem
  isSelected: boolean
  onSelectFile: (id: string | null) => void
  locale: string
  match?: FileCardProps['match']
  showAssignment: boolean
  renderActions?: (file: FileItem) => ReactNode
  wrapFile?: (file: FileItem, node: ReactNode) => ReactNode
  draggable: boolean
  where?: string
  selecting: boolean
  checked: boolean
  onToggle: (documentId: string) => void
}

export const FileTile = memo(function FileTile({
  file,
  isSelected,
  onSelectFile,
  locale,
  match,
  showAssignment,
  renderActions,
  wrapFile,
  draggable,
  selecting,
  checked,
  onToggle,
  where,
}: FileTileProps): ReactNode {
  const onSelect = useCallback(
    () => (selecting ? onToggle(file.id) : onSelectFile(file.id)),
    [selecting, onToggle, onSelectFile, file.id]
  )
  const card = (
    <FileCard
      file={file}
      isSelected={isSelected}
      onSelect={onSelect}
      locale={locale}
      match={match}
      footerLead={showAssignment ? <AssignmentFaces assignees={file.assignees} /> : undefined}
      actions={renderActions?.(file)}
      draggable={draggable}
      selection={selecting ? { checked } : undefined}
      where={where}
    />
  )
  return wrapFile ? wrapFile(file, card) : card
})

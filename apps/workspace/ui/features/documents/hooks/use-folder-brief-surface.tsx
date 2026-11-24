'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { offeredForRetry } from '@/lib/documents/retry-policy'
import type { FileItem, FolderItem } from '../file-types'
import type { FileShelf } from '../lib/file-shelf'
import {
  selectInBrief,
  type BriefSelection,
  type FolderBrief as FolderBriefData,
} from '../lib/folder-knowledge'
import { FolderBrief } from '../components/folder-brief'
import { useBriefCollapsed } from './use-brief-collapsed'
import { useBulkReingest } from './use-bulk-reingest'
import { useDocumentFindings } from './use-document-findings'
import { useMissingDocuments } from './use-missing-documents'
import { usePhoneLayout } from './use-phone-layout'

const NO_FILES: readonly FileItem[] = []

export function useFolderBriefSurface({
  shelf,
  brief,
  folders,
  selectedFolderId,
  onOpenFolder,
  onReingested,
  onReadAgainDone,
  onRequestDetails,
  detailsLoading,
  mayReadAgain,
}: {
  shelf: FileShelf
  brief: FolderBriefData | null
  folders: readonly FolderItem[]
  selectedFolderId: string | null
  onOpenFolder: (id: string | null) => void
  onReingested: (id: string, status: string) => void
  onReadAgainDone: () => void
  onRequestDetails: () => void
  detailsLoading: boolean
  mayReadAgain: boolean
}) {
  const t = useTranslations(filesCopy)
  const [collapsed, setCollapsed] = useBriefCollapsed(usePhoneLayout())
  const [selection, setSelection] = useState<{ folderId: string | null; selection: BriefSelection } | null>(null)
  const bulk = useBulkReingest(onReingested)
  const missing = useMissingDocuments(shelf.projectId)
  const findingsResponse = useDocumentFindings(shelf.projectId ?? undefined, { refreshKey: String(brief?.tally.readable ?? 0) })
  const findings = shelf.projectId && findingsResponse ? { projectId: shelf.projectId, response: findingsResponse } : null
  const folderName = selectedFolderId
    ? (folders.find((folder) => folder.id === selectedFolderId)?.name ?? null)
    : null
  const partial = brief?.partial === true

  const active = selection && selection.folderId === selectedFolderId ? selection.selection : null

  const failedIds = brief?.attention.failed
  const readAgain = useCallback(async () => {
    const ids = offeredForRetry(failedIds ?? []).map((file) => file.id)
    const result = await bulk.run(ids)
    const started = result.done - result.failed - (result.unchanged ?? 0)
    if (started > 0) toast.success(t('brief.readAgainDone', { count: started }))
    if (result.failed > 0) toast.error(t('brief.readAgainPartial', { count: result.failed }))
    onReadAgainDone()
  }, [failedIds, bulk, t, onReadAgainDone])

  const sliceLabel = (current: BriefSelection): string => {
    const what =
      current.kind === 'tag'
        ? current.tag
        : current.kind === 'topic'
          ? current.topic
          : current.kind === 'state'
            ? t(`brief.slice.${current.state}`)
            : t(`brief.slice.${current.kind}`)
    const where = folderName ? t('brief.sliceScopeFolder', { name: folderName }) : t('brief.sliceScopeRoot')
    return `${what} · ${where}`
  }

  const select = (next: BriefSelection) => {
    setSelection({ folderId: selectedFolderId, selection: next })
    if (partial) onRequestDetails()
  }

  return {
    brief: brief ? (
      <FolderBrief
        brief={brief}
        folderName={folderName}
        shelfKind={shelf.source}
        onSelect={select}
        onOpenFolder={onOpenFolder}
        onReadAgain={mayReadAgain ? () => void readAgain() : undefined}
        readAgainProgress={bulk.progress}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        missing={missing}
        findings={findings}
        hasSubfolders={folders.some((folder) => folder.parentId === selectedFolderId)}
        onLoadDetails={partial ? onRequestDetails : undefined}
        detailsLoading={detailsLoading}
      />
    ) : null,
    slice: active
      ? {
          files: brief && !partial ? selectInBrief(brief, active) : NO_FILES,
          loading: !brief || partial,
          label: sliceLabel(active),
          onClear: () => setSelection(null),
        }
      : undefined,
  }
}

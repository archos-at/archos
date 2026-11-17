import { FilePlus2, FolderInput, History, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { useTranslations } from '@/i18n'
import type { FolderUploadCounts, FolderUploadPlan, PlannedFile } from './folder-upload-plan'
import type { ProposedFile } from './revision-proposals'

type Translate = ReturnType<typeof useTranslations>

export function describeHeader({
  t,
  plan,
  single,
  sole,
  isFolder,
  destination,
}: {
  t: Translate
  plan: FolderUploadPlan | null
  single: PlannedFile | null
  sole: ProposedFile | null
  isFolder: boolean
  destination: string
}): { title: string; description: string; HeaderIcon: LucideIcon } {
  if (sole) return { ...describeSole(t, sole), HeaderIcon: History }
  if (single) {
    const shownAs = single.existingName ?? single.file.name
    return single.action === 'update'
      ? {
          title: t('folderUpload.single.newRevisionTitle', { name: single.file.name }),
          description: t('folderUpload.single.updateExplain', { name: shownAs }),
          HeaderIcon: History,
        }
      : {
          title: t('folderUpload.single.unchangedTitle'),
          description: t('folderUpload.single.unchangedExplain', { name: shownAs }),
          HeaderIcon: ShieldCheck,
        }
  }
  if (isFolder) {
    return {
      title: plan?.rootName ? t('folderUpload.title', { name: plan.rootName }) : t('folderUpload.titleGeneric'),
      description: plan?.mergedIntoCurrentFolder
        ? t('folderUpload.destinationMerged', { folder: destination })
        : t('folderUpload.destination', { folder: destination }),
      HeaderIcon: FolderInput,
    }
  }
  return {
    title: plan ? t('folderUpload.titleFiles', { count: plan.files.length }) : t('folderUpload.titleFilesGeneric'),
    description: t('folderUpload.destinationFiles', { folder: destination }),
    HeaderIcon: FilePlus2,
  }
}

function describeSole(t: Translate, sole: ProposedFile): { title: string; description: string } {
  const { of, candidates, newer } = sole.revisionOf
  const file = sole.file.name
  if (candidates.length > 1) {
    return { title: t('folderUpload.single.unclearTitle', { file }), description: t('folderUpload.single.unclearExplain') }
  }
  if (!newer) {
    return {
      title: t('folderUpload.single.unclearTitle', { file }),
      description: t('folderUpload.single.notNewerExplain', { file, name: of.name }),
    }
  }
  return {
    title: t('folderUpload.single.newRevisionTitle', { name: of.name }),
    description: t('folderUpload.single.revisionExplain', { file, name: of.name }),
  }
}

export function confirmLabel({
  t,
  counts,
  single,
  nothingToDo,
  revisions,
}: {
  t: Translate
  counts: FolderUploadCounts | null
  single: PlannedFile | null
  nothingToDo: boolean
  revisions: number
}): string {
  if (nothingToDo || !counts) return t('folderUpload.nothingToDo')
  if (single?.action === 'update') return t('folderUpload.single.confirmRevision')
  if (counts.uploading === 0) return t('folderUpload.confirmMoveOnly', { count: counts.moving })
  return revisions > 0
    ? t('folderUpload.confirmWithRevisions', { count: counts.uploading, revisions })
    : t('folderUpload.confirm', { count: counts.uploading })
}

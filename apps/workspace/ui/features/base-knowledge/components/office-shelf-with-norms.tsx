'use client'

import { useCallback, type JSX } from 'react'
import { Library } from 'lucide-react'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { OfficeShelfWorkspace, type FileItem, type OfficeShelfWorkspaceProps, type StoredUpload } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { useNormRecognition } from '../hooks/use-norm-recognition'
import { NormDialog } from './norm-dialog'

const NO_ACTIONS: readonly ActionMenuEntry[] = []

export function OfficeShelfWithNorms(props: Omit<OfficeShelfWorkspaceProps, 'onUploadsStored' | 'onNormsRecorded' | 'fileActions'>): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { recognition, recognize, close } = useNormRecognition()
  const { canManage } = props
  const onUploadsStored = useCallback(
    (uploads: StoredUpload[]) => void recognize(uploads.map((upload) => upload.documentId)),
    [recognize],
  )
  const onNormsRecorded = useCallback((documentIds: string[]) => void recognize(documentIds), [recognize])
  const fileActions = useCallback(
    (file: FileItem): readonly ActionMenuEntry[] =>
      canManage
        ? [
            {
              type: 'item',
              id: 'as-norm',
              label: t('norms.asNorm'),
              icon: Library,
              onSelect: () => void recognize([file.id], { asNorm: true }),
              testId: 'document-action-as-norm',
            },
          ]
        : NO_ACTIONS,
    [canManage, recognize, t],
  )
  return (
    <>
      <OfficeShelfWorkspace {...props} onUploadsStored={onUploadsStored} onNormsRecorded={onNormsRecorded} fileActions={fileActions} />
      <NormDialog recognition={recognition} onClose={close} onSettled={close} />
    </>
  )
}

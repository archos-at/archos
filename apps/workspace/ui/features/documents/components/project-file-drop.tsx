'use client'

import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { useFileDragDrop } from '../hooks/use-file-drag-drop'
import { handOverDroppedFiles } from '../lib/dropped-file-handover'
import type { FolderAccessLevel } from '../lib/file-shelf'
import { FileDropOverlay, useWindowDragGuard } from './file-drop-overlay'

const SECTIONS_WITH_OWN_DROP = new Set(['chat', 'files', 'intake', 'setup'])

export function routesDropToFiles(pathname: string, projectId: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'app' || parts[1] !== 'projects' || parts[2] !== projectId) return false
  return !SECTIONS_WITH_OWN_DROP.has(parts[3] ?? '')
}

export function ProjectFileDrop({
  projectId,
  disabled = false,
  rootAccess = 'write',
  children,
}: {
  projectId: string
  disabled?: boolean
  rootAccess?: FolderAccessLevel
  children: ReactNode
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const t = useTranslations(filesCopy)
  const active = !disabled && routesDropToFiles(pathname, projectId)

  const sendToFiles = useCallback(
    (files: File[]) => {
      handOverDroppedFiles(projectId, files)
      router.push(`/app/projects/${projectId}/files`)
    },
    [projectId, router]
  )
  const { isDragging, isUnsupportedDrag, refusal, dragHandlers } = useFileDragDrop({
    onDrop: sendToFiles,
    disabled: !active,
    refusal: rootAccess === 'write' ? null : t('workspace.dropRefusedHere'),
    acceptZip: true,
  })
  useWindowDragGuard()

  return (
    <div className="contents" {...(active ? dragHandlers : {})} data-testid="project-file-drop">
      <FileDropOverlay
        show={active && isDragging}
        isUnsupported={isUnsupportedDrag}
        uploadLabel={t('workspace.dropToUpload')}
        unsupportedLabel={t('workspace.dropUnsupported')}
        refusal={refusal}
        testId="project-drop-overlay"
      />
      {children}
    </div>
  )
}

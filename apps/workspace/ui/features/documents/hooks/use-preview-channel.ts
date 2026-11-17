'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MAIL_ENTRY_PARAM } from '../components/mail-thread/mail-thread-model'
import type { FileItem } from '../file-types'
import { refreshedFileFields } from '../lib/file-item'
import type { FileShelf } from '../lib/file-shelf'
import { clearDocumentLocus } from '../lib/document-locus'
import { backLandsOn } from '@/lib/navigation/history-step'
import { clearReviewParams, readDocumentBack } from '../lib/open-review'
import { useFilePreviewStore, type FilePreviewContext } from '../stores/file-preview-store'

export interface PreviewHandlers {
  onRenamed: (fileId: string, displayName: string | null) => void
  onDeleted: (fileId: string) => void
  onReingested: (fileId: string, status: string) => void
  onTagsUpdated: (fileId: string, tags: string[], topics?: string[]) => void
  onOpenDocument: (fileId: string) => void
  onRevisionChanged: NonNullable<FilePreviewContext['onRevisionChanged']>
  onLifecycleChanged: NonNullable<FilePreviewContext['onLifecycleChanged']>
  onMarksChanged: NonNullable<FilePreviewContext['onMarksChanged']>
}

export function usePreviewChannel(
  shelf: FileShelf,
  files: readonly FileItem[],
  handlers: PreviewHandlers
) {
  const storeFileId = useFilePreviewStore((state) => state.file?.id ?? null)
  const [dialogId, setDialogId] = useState<string | null>(null)
  const viaStore = shelf.preview.kind === 'store'
  const dialogFile = viaStore ? null : (files.find((f) => f.id === dialogId) ?? null)
  const openId = viaStore ? storeFileId : (dialogFile?.id ?? null)
  const projectName = shelf.preview.kind === 'store' ? shelf.preview.projectName : undefined

  const open = useCallback(
    (file: FileItem) => {
      if (!viaStore) {
        setDialogId(file.id)
        return
      }
      useFilePreviewStore.getState().open(file, 'modal', {
        projectId: shelf.projectId ?? undefined,
        projectName,
        scope: shelf.documentScope,
        canCollaborate: shelf.canCollaborate,
        showModels: shelf.showModels,
        lifecyclePermissions: shelf.lifecyclePermissions,
        viewerUserId: shelf.currentUserId,
        ...handlers,
      })
    },
    [viaStore, shelf, projectName, handlers]
  )

  const close = useCallback(() => {
    if (viaStore) useFilePreviewStore.getState().close()
    else setDialogId(null)
  }, [viaStore])

  useEffect(() => {
    if (!viaStore) return
    const store = useFilePreviewStore.getState()
    const held = store.file
    const fresh = held && files.find((f) => f.id === held.id)
    if (!held || !fresh) return
    const patch = refreshedFileFields(held, fresh)
    if (patch) store.patchFile(patch)
  }, [viaStore, files])

  return { openId, open, close, dialogFile }
}

export function useDocParamSync({
  openId,
  files,
  onUrlOpen,
  onUrlClose,
}: {
  openId: string | null
  files: readonly FileItem[]
  onUrlOpen: (id: string) => void
  onUrlClose: () => void
}): void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const docParam = searchParams?.get('doc')
  const previousDocRef = useRef<string | null>(null)
  const previousOpenRef = useRef<string | null>(null)

  useEffect(() => {
    const wanted = docParam ?? null
    const urlMoved = previousDocRef.current !== wanted
    const previewMoved = previousOpenRef.current !== openId
    previousOpenRef.current = openId

    if (wanted === openId) {
      previousDocRef.current = wanted
      return
    }

    if (previewMoved) {
      previousDocRef.current = wanted
      const back = openId === null ? readDocumentBack(searchParams) : null
      if (back) {
        if (backLandsOn(back)) router.back()
        else router.replace(back, { scroll: false })
        return
      }
      const params = clearDocumentLocus(clearReviewParams(new URLSearchParams(searchParams?.toString() ?? '')))
      params.delete(MAIL_ENTRY_PARAM)
      const path = pathname ?? ''
      if (openId === null) {
        params.delete('doc')
        const query = params.toString()
        router.replace(query ? `${path}?${query}` : path, { scroll: false })
      } else {
        params.set('doc', openId)
        router.push(`${path}?${params.toString()}`, { scroll: false })
      }
      return
    }

    if (!urlMoved) return

    if (wanted === null) {
      previousDocRef.current = wanted
      onUrlClose()
      return
    }
    if (!files.some((file) => file.id === wanted)) return
    previousDocRef.current = wanted
    onUrlOpen(wanted)
  }, [docParam, openId, files, onUrlOpen, onUrlClose, pathname, router, searchParams])
}

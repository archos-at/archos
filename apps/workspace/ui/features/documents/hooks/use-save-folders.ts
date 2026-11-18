'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderItem } from '../file-types'
import type { FolderAccessLevel } from '../lib/file-shelf'
import { shelfRefusalOf } from '../lib/move-refusal'

export type SaveFoldersStatus = 'loading' | 'ready' | 'failed'

export type CreateFolderOutcome = { ok: true; folder: FolderItem } | { ok: false; nameTaken: boolean }

export function projectFoldersUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/folders`
}

export interface KnownFolders {
  folders: readonly FolderItem[]
  rootAccess: FolderAccessLevel
}

export function useSaveFolders(projectId: string, enabled: boolean, known?: KnownFolders) {
  const url = projectFoldersUrl(projectId)
  const [folders, setFolders] = useState<FolderItem[]>(() => [...(known?.folders ?? [])])
  const [rootAccess, setRootAccess] = useState<FolderAccessLevel>(known?.rootAccess ?? 'write')
  const [status, setStatus] = useState<SaveFoldersStatus>(known ? 'ready' : 'loading')
  const seeded = useRef(known !== undefined)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const stamp = ++generation.current
    setStatus('loading')
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to load folders (${response.status})`)
      const data = (await response.json()) as { folders?: FolderItem[]; rootAccess?: FolderAccessLevel }
      if (stamp !== generation.current) return
      setFolders(data.folders ?? [])
      setRootAccess(data.rootAccess === 'read' ? 'read' : 'write')
      setStatus('ready')
    } catch {
      if (stamp === generation.current) setStatus('failed')
    }
  }, [url])

  useEffect(() => {
    if (enabled && !seeded.current) void load()
  }, [enabled, load])

  const create = useCallback(
    async (name: string, parentId: string | null): Promise<CreateFolderOutcome> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId: parentId ?? undefined }),
      })
      if (!response.ok) return { ok: false, nameTaken: (await shelfRefusalOf(response)) === 'nameTaken' }
      const data = (await response.json()) as { folder: FolderItem }
      const folder: FolderItem = { access: 'write', ...data.folder }
      setFolders((previous) => [...previous, folder])
      return { ok: true, folder }
    },
    [url],
  )

  return { folders, rootAccess, status, load, create }
}

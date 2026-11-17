'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { FileItem } from '../file-types'

const STAGE_PARAMS = ['model', 'element', 'hl', 'storey', 'xray', 'tab', 'view', 'cut', 'cutup', 'proj']

export function useModelStage(enabled: boolean, files: readonly FileItem[]) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const stageModel = enabled ? (searchParams?.get('model')?.trim() ?? null) : null
  const stageDocument = useMemo(
    () => (stageModel === null ? null : (files.find((file) => file.filename === stageModel) ?? null)),
    [files, stageModel]
  )

  const closeModel = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    for (const key of STAGE_PARAMS) params.delete(key)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  return { stageModel, stageDocument, closeModel }
}

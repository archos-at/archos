'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useRevisionCompare } from '../components/revision-compare'
import type { FileItem } from '../file-types'
import { COMPARE_PARAM } from '../lib/revision-compare-link'

export function useCompareParam(files: readonly FileItem[], listingComplete = true): JSX.Element | null {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const olderId = searchParams?.get(COMPARE_PARAM) ?? null
  const newerId = searchParams?.get('doc') ?? null
  const { openRevisionCompare, compareElement } = useRevisionCompare()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!olderId) return
    const key = `${newerId ?? ''}:${olderId}`
    if (handled.current === key) return
    const newer = newerId ? files.find((file) => file.id === newerId) : undefined
    if (!newer) return
    const older = files.find((file) => file.id === olderId)
    if (!older && !listingComplete) return
    handled.current = key
    if (older && older.id !== newer.id) {
      openRevisionCompare(
        { id: older.id, filename: older.filename },
        { id: newer.id, filename: newer.filename }
      )
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete(COMPARE_PARAM)
    const query = params.toString()
    const path = pathname ?? ''
    router.replace(query ? `${path}?${query}` : path, { scroll: false })
  }, [files, listingComplete, newerId, olderId, openRevisionCompare, pathname, router, searchParams])

  return compareElement
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSnapTargets, type SnapTargets } from '@/lib/drawing-tape/snap-wire'
import {
  buildSnapIndex,
  snapPoint,
  type PagePixels,
  type SnapIndex,
  type SnapKind,
} from '../lib/sheet-snap'

export const SNAP_RADIUS_PX = 12
export type SnapHit = { at: [number, number]; kind: SnapKind }

export function useSnapSheet(documentId: string, enabled: boolean) {
  const [loaded, setLoaded] = useState<ReadonlyMap<number, SnapIndex>>(new Map())
  const asked = useRef(new Set<number>())

  useEffect(() => {
    asked.current = new Set()
    setLoaded(new Map())
  }, [documentId])

  const load = useCallback(
    (page: number) => {
      if (!enabled || asked.current.has(page)) return
      asked.current.add(page)
      fetchSnapTargets(documentId, page)
        .then((found: SnapTargets) =>
          setLoaded((held) => new Map(held).set(page, buildSnapIndex(found)))
        )
        .catch(() => asked.current.delete(page))
    },
    [documentId, enabled]
  )

  const snap = useCallback(
    (page: number, raw: readonly [number, number], size: PagePixels): SnapHit => {
      const index = loaded.get(page)
      if (!index) {
        load(page)
        return { at: [raw[0], raw[1]], kind: 'free' }
      }
      return snapPoint(index, raw, size, SNAP_RADIUS_PX) ?? { at: [raw[0], raw[1]], kind: 'free' }
    },
    [loaded, load]
  )

  return { load, snap }
}

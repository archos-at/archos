'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast, type ExternalToast } from 'sonner'

export const FILING_HOLD_MS = 5000

interface Hold {
  ids: readonly string[]
  timer: number
  run: (toastId: string | number) => Promise<void>
  toastId: string | number
}

export interface HeldFilings {
  held: ReadonlySet<string>
  hold: (input: { ids: readonly string[]; label: string; undoLabel: string; run: (toastId: string | number) => Promise<void>; onUndo: () => void; toastOptions?: ExternalToast }) => void
}

/** A filing waits {@link FILING_HOLD_MS} behind „Rückgängig“ in the one toast that later says where it landed; leaving the page sends it at once. */
export function useHeldFilings(holdMs = FILING_HOLD_MS): HeldFilings {
  const holds = useRef(new Map<number, Hold>())
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set())
  const release = useCallback((ids: readonly string[]) => {
    setHeld((current) => new Set([...current].filter((id) => !ids.includes(id))))
  }, [])

  const fire = useCallback(
    (key: number) => {
      const entry = holds.current.get(key)
      if (!entry) return
      holds.current.delete(key)
      window.clearTimeout(entry.timer)
      void entry.run(entry.toastId).finally(() => release(entry.ids))
    },
    [release]
  )

  const hold = useCallback<HeldFilings['hold']>(
    ({ ids, label, undoLabel, run, onUndo, toastOptions }) => {
      const key = window.setTimeout(() => fire(key), holdMs)
      const toastId = toast.loading(label, {
        ...toastOptions,
        action: {
          label: undoLabel,
          onClick: () => {
            if (!holds.current.delete(key)) return
            window.clearTimeout(key)
            toast.dismiss(toastId)
            release(ids)
            onUndo()
          },
        },
      })
      holds.current.set(key, { ids, timer: key, run, toastId })
      setHeld((current) => new Set([...current, ...ids]))
    },
    [fire, release, holdMs]
  )

  useEffect(() => {
    const flush = () => [...holds.current.keys()].forEach(fire)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [fire])

  return { held, hold }
}

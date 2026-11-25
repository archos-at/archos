'use client'

import { useCallback, useState } from 'react'

export interface MailSelection {
  checked: ReadonlySet<string>
  selecting: boolean
  start: () => void
  end: () => void
  toggle: (mailId: string, value: boolean) => void
}

/** Picking is a mode, as in Dateien: started by „Auswählen“ (or a first tick by X), ended by the bar's × or a decision. */
export function useMailSelection(initialChecked: readonly string[] = []): MailSelection {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(initialChecked))
  const [started, setStarted] = useState(false)
  const start = useCallback(() => setStarted(true), [])
  const end = useCallback(() => {
    setStarted(false)
    setChecked(new Set())
  }, [])
  const toggle = useCallback((mailId: string, value: boolean) => {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(mailId)
      else next.delete(mailId)
      return next
    })
  }, [])
  return { checked, selecting: started || checked.size > 0, start, end, toggle }
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { type BimModelView } from '../lib/model-link'

export function useAdvancedSheet({
  linkedOpen,
  view,
  setView,
  focusViewport,
}: {
  linkedOpen: boolean
  view: BimModelView
  setView: (patch: Partial<BimModelView>) => void
  focusViewport: () => void
}) {
  const [advancedOpen, setAdvancedOpenEcho] = useState(linkedOpen)
  useEffect(() => setAdvancedOpenEcho(linkedOpen), [linkedOpen])
  const setAdvancedOpen = useCallback(
    (open: boolean) => {
      setAdvancedOpenEcho(open)
      setView({ tab: open ? (view.tab ?? 'overview') : undefined })
    },
    [setView, view.tab]
  )
  const advancedToggleRef = useRef<HTMLButtonElement>(null)
  const restoreAdvancedFocus = useRef(false)
  const closeAdvanced = useCallback(() => {
    restoreAdvancedFocus.current = true
    setAdvancedOpen(false)
  }, [setAdvancedOpen])
  useEffect(() => {
    if (advancedOpen || !restoreAdvancedFocus.current) return
    restoreAdvancedFocus.current = false
    if (advancedToggleRef.current) advancedToggleRef.current.focus()
    else focusViewport()
  }, [advancedOpen, focusViewport])

  return {
    advancedOpen,
    setAdvancedOpenEcho,
    setAdvancedOpen,
    advancedToggleRef,
    restoreAdvancedFocus,
    closeAdvanced,
  }
}

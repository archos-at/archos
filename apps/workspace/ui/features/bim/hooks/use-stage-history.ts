import { useCallback, useRef, useState } from 'react'

import { STAGE_HISTORY_DEPTH, type StageStep } from '../components/model-stage-helpers'

export function useStageHistory() {
  const [history, setHistory] = useState<StageStep[]>([])

  const collecting = useRef<StageStep | null>(null)

  const pushStep = useCallback((step: StageStep) => {
    if (collecting.current) {
      collecting.current = {
        view: collecting.current.view ?? step.view,
        visibility: collecting.current.visibility ?? step.visibility,
      }
      return
    }
    setHistory((stack) => [...stack, step].slice(-STAGE_HISTORY_DEPTH))
  }, [])

  const asOneStep = useCallback((gesture: () => void) => {
    collecting.current = { view: null, visibility: null }
    try {
      gesture()
    } finally {
      const step = collecting.current
      collecting.current = null
      if (step && (step.view || step.visibility)) {
        setHistory((stack) => [...stack, step].slice(-STAGE_HISTORY_DEPTH))
      }
    }
  }, [])

  return { history, setHistory, collecting, pushStep, asOneStep }
}

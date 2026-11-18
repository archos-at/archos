'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  SHOW_REASONING_SKILLS_DEFAULT,
  fetchUserPreferences,
  readShowReasoningSkills,
  setShowReasoningSkills,
} from './client'

export interface ShowReasoningSkillsState {
  showReasoningSkills: boolean
  loading: boolean
  setShowReasoningSkills: (value: boolean) => void
}

export function useShowReasoningSkills(): ShowReasoningSkillsState {
  const [value, setValue] = useState<boolean>(SHOW_REASONING_SKILLS_DEFAULT)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchUserPreferences()
      .then((prefs) => {
        if (!cancelled) setValue(readShowReasoningSkills(prefs))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((next: boolean) => {
    setValue(next)
    void setShowReasoningSkills(next)
  }, [])

  return { showReasoningSkills: value, loading, setShowReasoningSkills: update }
}

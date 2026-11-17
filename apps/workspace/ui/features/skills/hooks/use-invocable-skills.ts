'use client'

import { useEffect, useRef, useState } from 'react'
import { listInvocableSkills, type InvocableSkill } from '@/adapters/api/skills-client'

export interface InvocableSkillsState {
  skills: InvocableSkill[]
  loading: boolean
  loaded: boolean
  available: boolean
}

export function useInvocableSkills(enabled: boolean): InvocableSkillsState {
  const [skills, setSkills] = useState<InvocableSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(false)
  const requested = useRef(false)

  useEffect(() => {
    if (!enabled || requested.current) return
    requested.current = true
    let cancelled = false

    setLoading(true)
    listInvocableSkills()
      .then((result) => {
        if (cancelled) return
        setSkills(result)
        setAvailable(true)
      })
      .catch(() => {
        if (cancelled) return
        setSkills([])
        setAvailable(false)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { skills, loading, loaded, available }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { projectIntakeCopy } from '@/i18n/namespaces/project-intake'
import {
  createProjectIntakeClient,
  type ProjectIntakeClient,
} from '@/lib/project-intake/client'
import type { IntakeDecision, IntakeView } from '@/lib/project-intake/types'

export const INTAKE_POLL_MS = 5000
export const INTAKE_WATCH_MS = 3 * 60 * 1000

export interface UseIntakeOptions {
  projectId: string
  initial: IntakeView
  client?: ProjectIntakeClient
}

export interface UseIntake {
  view: IntakeView
  busy: boolean
  stale: boolean
  decide: (decisions: IntakeDecision[]) => Promise<boolean>
  reread: () => Promise<void>
  complete: () => Promise<boolean>
  refresh: () => Promise<void>
  watch: () => void
}

export function useIntake({ projectId, initial, client }: UseIntakeOptions): UseIntake {
  const t = useTranslations(projectIntakeCopy)
  const api = useRef<ProjectIntakeClient>(client ?? createProjectIntakeClient())
  const [view, setView] = useState<IntakeView>(initial)
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)
  const [watchUntil, setWatchUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      setView(await api.current.get(projectId))
      setStale(false)
    } catch {
      setStale(true)
    }
  }, [projectId])

  const polling = view.status === 'reading' || now < watchUntil
  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => {
      setNow(Date.now())
      void refresh()
    }, INTAKE_POLL_MS)
    return () => clearInterval(timer)
  }, [polling, refresh])

  const guarded = useCallback(
    async <T>(work: () => Promise<T>, failure: string): Promise<T | null> => {
      setBusy(true)
      try {
        return await work()
      } catch (error) {
        console.error('[project-intake] call failed:', error)
        toast.error(failure)
        return null
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const decide = useCallback(
    async (decisions: IntakeDecision[]): Promise<boolean> => {
      const answer = await guarded(() => api.current.decide(projectId, decisions), t('errors.decide'))
      if (!answer) return false
      setView(answer.intake)
      const refused = answer.results.filter((result) => !result.ok).length
      if (refused > 0) toast.error(t('errors.refused', { count: refused }))
      return refused === 0
    },
    [guarded, projectId, t]
  )

  const reread = useCallback(async () => {
    const next = await guarded(() => api.current.start(projectId, { scope: 'new' }), t('errors.start'))
    if (next) setView(next)
  }, [guarded, projectId, t])

  const complete = useCallback(async (): Promise<boolean> => {
    const next = await guarded(() => api.current.complete(projectId), t('errors.complete'))
    if (!next) return false
    setView(next)
    return true
  }, [guarded, projectId, t])

  const watch = useCallback(() => {
    const at = Date.now()
    setNow(at)
    setWatchUntil(at + INTAKE_WATCH_MS)
  }, [])

  return { view, busy, stale, decide, reread, complete, refresh, watch }
}

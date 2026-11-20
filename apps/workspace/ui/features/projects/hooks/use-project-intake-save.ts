import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'

import { toast } from 'sonner'

import { projectTourUrl } from '@/lib/onboarding/product-tour'
import { motionDeliberate, useMotionToken } from '@/components/motion'

import { useLocale, useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { answerKeyFor, type BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import { evaluateIntakeCondition } from '@/lib/project-profile/intake-conditions'
import { checkIntakeConsistencyFromAnswers, collectFreeTextFields, collectStructuredContextFields } from '@/lib/project-profile/intake-consistency'
import type { ConsistencyFinding } from '@/lib/project-profile/intake-consistency'
import { buildIntakeProfile, mergeIntakeProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { ProjectProfile } from '@/lib/project-profile/types'

import { isQuestionSatisfied, SaveRefused, saveRefusal, type Answers } from '../components/project-intake-helpers'
import { createUploadTracker, sendPendingBinds, type PendingRoleBind } from '../lib/pending-role-binds'

interface UseProjectIntakeSaveOptions {
  projectId: string
  projectName: string | undefined
  mode: 'create' | 'edit'
  initialProfile: ProjectProfile | null
  initialProfileVersion: number | null
  conflictCheckEnabled: boolean
  STORAGE_KEY: string
  definition: ProjectIntakeDefinition | null
  answers: Answers
  buildings: BuildingInstance[]
  pendingBindsRef: { current: PendingRoleBind[] }
  setTouched: Dispatch<SetStateAction<Set<string>>>
  goToStep: (step: number) => void
  setError: Dispatch<SetStateAction<string | null>>
  setConflict: Dispatch<SetStateAction<boolean>>
  setFindings: Dispatch<SetStateAction<ConsistencyFinding[] | null>>
  setChecking: Dispatch<SetStateAction<boolean>>
}

export function useProjectIntakeSave({
  projectId,
  projectName,
  mode,
  initialProfile,
  initialProfileVersion,
  conflictCheckEnabled,
  STORAGE_KEY,
  definition,
  answers,
  buildings,
  pendingBindsRef,
  setTouched,
  goToStep,
  setError,
  setConflict,
  setFindings,
  setChecking,
}: UseProjectIntakeSaveOptions) {
  const t = useTranslations(projectsCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const deferredUploads = useMemo(() => createUploadTracker(), [])
  const [saving, setSaving] = useState(false)
  const completionBeat = useMotionToken(motionDeliberate)
  const completionBeatMs = (completionBeat.duration ?? 0) * 1000
  const [saved, setSaved] = useState(false)

  const runSave = useCallback(async () => {
    if (!definition) return
    setFindings(null)
    setSaving(true)
    setError(null)
    setConflict(false)
    try {
      await deferredUploads.settled()
      const built = buildIntakeProfile(answers, definition, { projectName, buildings })
      const profile: ProjectProfile = mergeIntakeProfile(built, initialProfile, definition)
      const res = await fetch(`/api/projects/${projectId}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof initialProfileVersion === 'number'
            ? { 'If-Match': String(initialProfileVersion) }
            : {}),
        },
        body: JSON.stringify(profile),
      })
      if (!res.ok) {
        if (res.status === 409 || res.status === 403) throw await saveRefusal(res, t)
        throw new Error('Failed to save')
      }

      const refused = await sendPendingBinds(projectId, pendingBindsRef.current)
      if (refused.length > 0) {
        toast.error(t('intake.bindRefused', { files: refused.map((bind) => bind.filename).join(', ') }))
      }

      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }

      const capturedCount = Object.keys(built.facts).length + Object.keys(built.goals).length
      setSaved(true)
      await new Promise((resolve) => window.setTimeout(resolve, completionBeatMs))
      toast.success(t('intake.saveSuccess', { count: capturedCount }))
      router.push(mode === 'create' ? projectTourUrl(projectId) : `/app/projects/${projectId}`)
      router.refresh()
    } catch (e) {
      const isConflict = e instanceof Error && e.message === t('intake.errors.saveConflict')
      setConflict(isConflict)
      setError(isConflict || e instanceof SaveRefused ? (e as Error).message : t('intake.errors.saveFailed'))
      setSaving(false)
    }
  }, [
    definition,
    answers,
    buildings,
    initialProfile,
    initialProfileVersion,
    mode,
    deferredUploads,
    projectId,
    projectName,
    router,
    STORAGE_KEY,
    completionBeatMs,
    t,
    setFindings,
    setError,
    setConflict,
    pendingBindsRef,
  ])

  const reloadAfterConflict = useCallback(() => {
    setError(null)
    setConflict(false)
    router.refresh()
  }, [router, setError, setConflict])

  const firstMissingRequired = useCallback((): { stageIndex: number; key: string } | null => {
    if (!definition) return null
    for (const [stageIndex, s] of definition.stages.entries()) {
      if (s.scope === 'building') {
        for (const bw of buildings) {
          for (const q of s.questions) {
            if (!q.required) continue
            const key = answerKeyFor(q.id, bw.id)
            if (!evaluateIntakeCondition(q, answers, bw.id)) continue
            if (!isQuestionSatisfied(q, answers, key)) return { stageIndex, key }
          }
        }
        continue
      }
      for (const q of s.questions) {
        if (!q.required) continue
        if (!evaluateIntakeCondition(q, answers)) continue
        if (!isQuestionSatisfied(q, answers, q.id)) return { stageIndex, key: q.id }
      }
    }
    return null
  }, [definition, buildings, answers])

  const handleSave = useCallback(async () => {
    if (!definition) return

    const missing = firstMissingRequired()
    if (missing) {
      setTouched((previous) => new Set(previous).add(missing.key))
      goToStep(missing.stageIndex)
      return
    }

    if (!conflictCheckEnabled) {
      await runSave()
      return
    }
    setError(null)

    let deterministic: ConsistencyFinding[]
    let freeText: ReturnType<typeof collectFreeTextFields>
    try {
      deterministic = checkIntakeConsistencyFromAnswers(answers, definition)
      freeText = collectFreeTextFields(answers, definition)
    } catch (e) {
      console.error(
        '[ProjectIntakeWizard] Pre-save consistency gate threw; saving anyway (fail-open):',
        e
      )
      await runSave()
      return
    }

    let aiFindings: ConsistencyFinding[] = []
    if (freeText.length > 0) {
      setChecking(true)
      try {
        const res = await fetch(`/api/projects/${projectId}/consistency-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            freeText,
            structured: collectStructuredContextFields(answers, definition),
            locale,
          }),
        })
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as {
            findings?: ConsistencyFinding[] | null
          } | null
          if (data?.findings) aiFindings = data.findings
        } else {
          console.warn(
            '[ProjectIntakeWizard] Consistency check returned a non-ok status (non-fatal):',
            res.status
          )
        }
      } catch (e) {
        console.warn('[ProjectIntakeWizard] Consistency check request failed (non-fatal):', e)
      } finally {
        setChecking(false)
      }
    }

    const all: ConsistencyFinding[] = [...deterministic, ...aiFindings]
    if (all.length > 0) {
      setFindings(all)
      return
    }
    await runSave()
  }, [
    definition,
    conflictCheckEnabled,
    answers,
    projectId,
    locale,
    runSave,
    firstMissingRequired,
    goToStep,
    setTouched,
    setError,
    setChecking,
    setFindings,
  ])

  const handleProceedAnyway = useCallback(() => {
    void runSave()
  }, [runSave])

  const handleReviseAt = useCallback(
    (stageIndex: number) => {
      setFindings(null)
      goToStep(stageIndex)
    },
    [goToStep, setFindings]
  )

  return {
    deferredUploads,
    saving,
    setSaving,
    saved,
    setSaved,
    completionBeat,
    completionBeatMs,
    runSave,
    reloadAfterConflict,
    firstMissingRequired,
    handleSave,
    handleProceedAnyway,
    handleReviseAt,
  }
}

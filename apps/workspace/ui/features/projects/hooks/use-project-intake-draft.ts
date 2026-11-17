import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { defaultBuildings } from '@/lib/project-profile/intake-building-keys'
import type { BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import { buildingsFromAnswers, pruneStaleConditionalAnswers } from '@/lib/project-profile/intake-conditions'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { useTranslations } from '@/i18n'

import { projectsCopy } from '@/i18n/namespaces/projects'
import { maxBuildingNumber } from '../components/project-intake-buildings'
import { draftShouldWinInEditMode, type Answers, type IntakeDraft } from '../components/project-intake-helpers'
import { pendingBindsFromDraft, type PendingRoleBind } from '../lib/pending-role-binds'

interface UseProjectIntakeDraftOptions {
  projectId: string
  projectName: string | undefined
  mode: 'create' | 'edit'
  initialProfile: ProjectProfile | null
  initialProfileVersion: number | null
  definitionOverride: ProjectIntakeDefinition | undefined
  initialStep: number
  setError: Dispatch<SetStateAction<string | null>>
}

export function useProjectIntakeDraft({
  projectId,
  projectName,
  mode,
  initialProfile,
  initialProfileVersion,
  definitionOverride,
  initialStep,
  setError,
}: UseProjectIntakeDraftOptions) {
  const t = useTranslations(projectsCopy)
  const [definition, setDefinition] = useState<ProjectIntakeDefinition | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [answers, setAnswers] = useState<Answers>({})
  const [buildings, setBuildings] = useState<BuildingInstance[]>(defaultBuildings())
  const [pendingBinds, setPendingBinds] = useState<PendingRoleBind[]>([])
  const pendingBindsRef = useRef<PendingRoleBind[]>([])
  const updatePendingBinds = useCallback(
    (next: (previous: PendingRoleBind[]) => PendingRoleBind[]) => {
      pendingBindsRef.current = next(pendingBindsRef.current)
      setPendingBinds(pendingBindsRef.current)
    },
    []
  )
  const [draftSaved, setDraftSaved] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const STORAGE_KEY = `intake-draft-v3-${projectId}`
  const LEGACY_STORAGE_KEYS = [`intake-draft-${projectId}`, `intake-draft-v2-${projectId}`]
  const isEdit = mode === 'edit'
  const buildingCounter = useRef(1)

  useEffect(() => {
    let cancelled = false
    const load = definitionOverride
      ? Promise.resolve(definitionOverride)
      : fetch(`/api/projects/${projectId}/intake-definition`).then((r) =>
          r.ok
            ? (r.json() as Promise<ProjectIntakeDefinition>)
            : Promise.reject(new Error('Failed to load'))
        )
    load
      .then((data: ProjectIntakeDefinition) => {
        if (cancelled) return
        setDefinition(data)

        let restored = false
        try {
          for (const legacyKey of LEGACY_STORAGE_KEYS) localStorage.removeItem(legacyKey)
        } catch {
          /* storage may be blocked */
        }
        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) {
            const parsed = JSON.parse(raw) as IntakeDraft
            if (parsed.answers) {
              const restoreDraft =
                !isEdit ||
                !initialProfile ||
                draftShouldWinInEditMode(parsed, initialProfile, initialProfileVersion)
              if (restoreDraft) {
                const draftBuildings =
                  parsed.buildings && parsed.buildings.length > 0
                    ? parsed.buildings
                    : buildingsFromAnswers(parsed.answers)
                setBuildings(draftBuildings)
                updatePendingBinds(() => pendingBindsFromDraft(parsed.pendingBinds))
                buildingCounter.current = maxBuildingNumber(draftBuildings)
                setAnswers(pruneStaleConditionalAnswers(parsed.answers, data))
                if (typeof parsed.currentStep === 'number') setCurrentStep(parsed.currentStep)
                restored = true
              } else {
                try {
                  localStorage.removeItem(STORAGE_KEY)
                } catch {
                  /* ignore */
                }
              }
            }
          }
        } catch {
          /* invalid draft, ignore */
        }

        if (!restored) {
          if (initialProfile) {
            const seeded = answersFromProfile(initialProfile, data)
            setBuildings(seeded.buildings)
            buildingCounter.current = maxBuildingNumber(seeded.buildings)
            setAnswers(pruneStaleConditionalAnswers(seeded.answers, data))
          } else if (projectName && !isEdit) {
            setAnswers({ A1: projectName })
          }
        }
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('intake.errors.loadFailed'))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, loadAttempt])

  const retryLoad = useCallback(() => {
    setError(null)
    setLoading(true)
    setLoadAttempt((attempt) => attempt + 1)
  }, [setError])

  useEffect(() => {
    if (loading) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            answers,
            buildings,
            pendingBinds,
            currentStep,
            savedAt: Date.now(),
            baseVersion: typeof initialProfileVersion === 'number' ? initialProfileVersion : null,
          } satisfies IntakeDraft)
        )
        setDraftSaved(true)
      } catch {
        /* quota exceeded, ignore */
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [answers, buildings, pendingBinds, currentStep, STORAGE_KEY, loading, initialProfileVersion])

  useEffect(() => {
    if (draftSaved) {
      const timer = setTimeout(() => setDraftSaved(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [draftSaved])

  return {
    definition,
    setDefinition,
    loading,
    setLoading,
    currentStep,
    setCurrentStep,
    answers,
    setAnswers,
    buildings,
    setBuildings,
    pendingBinds,
    setPendingBinds,
    pendingBindsRef,
    updatePendingBinds,
    buildingCounter,
    draftSaved,
    setDraftSaved,
    loadAttempt,
    setLoadAttempt,
    retryLoad,
    STORAGE_KEY,
    LEGACY_STORAGE_KEYS,
    isEdit,
  }
}

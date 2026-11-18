import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { useLocale, useTranslations } from '@/i18n'

import { projectsCopy } from '@/i18n/namespaces/projects'
import type { ConsistencyFinding } from '@/lib/project-profile/intake-consistency'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { ProjectProfile } from '@/lib/project-profile/types'

import { useProjectIntakeBuildings } from '../hooks/use-project-intake-buildings'
import { useProjectIntakeDraft } from '../hooks/use-project-intake-draft'
import { useProjectIntakeSave } from '../hooks/use-project-intake-save'
import { useProjectIntakeStages } from '../hooks/use-project-intake-stages'

export interface ProjectIntakeWizardProps {
  projectId: string
  projectName?: string
  mode?: 'create' | 'edit'
  initialProfile?: ProjectProfile | null
  initialProfileVersion?: number | null
  conflictCheckEnabled?: boolean
  salvageNotice?: 'partial' | 'full' | null
  definitionOverride?: ProjectIntakeDefinition
  initialStep?: number
}

export function useProjectIntakeWizardController(props: ProjectIntakeWizardProps) {
  const {
  projectId,
  projectName,
  mode = 'create',
  initialProfile = null,
  initialProfileVersion = null,
  conflictCheckEnabled = false,
  salvageNotice = null,
  definitionOverride,
  initialStep = 0,
  } = props
  const t = useTranslations(projectsCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [findings, setFindings] = useState<ConsistencyFinding[] | null>(null)
  const [checking, setChecking] = useState(false)

  const draft = useProjectIntakeDraft({
    projectId,
    projectName,
    mode,
    initialProfile,
    initialProfileVersion,
    definitionOverride,
    initialStep,
    setError,
  })
  const stageControls = useProjectIntakeStages({
    definition: draft.definition,
    answers: draft.answers,
    setAnswers: draft.setAnswers,
    buildings: draft.buildings,
    currentStep: draft.currentStep,
    setCurrentStep: draft.setCurrentStep,
    setError,
    setConflict,
    setFindings,
  })
  const buildingControls = useProjectIntakeBuildings({
    initialProfile,
    definition: draft.definition,
    buildingCounter: draft.buildingCounter,
    setBuildings: draft.setBuildings,
    setAnswers: draft.setAnswers,
    updatePendingBinds: draft.updatePendingBinds,
  })
  const saveControls = useProjectIntakeSave({
    projectId,
    projectName,
    mode,
    initialProfile,
    initialProfileVersion,
    conflictCheckEnabled,
    STORAGE_KEY: draft.STORAGE_KEY,
    definition: draft.definition,
    answers: draft.answers,
    buildings: draft.buildings,
    pendingBindsRef: draft.pendingBindsRef,
    setTouched: stageControls.setTouched,
    goToStep: stageControls.goToStep,
    setError,
    setConflict,
    setFindings,
    setChecking,
  })

  const progress = ((draft.currentStep + 1) / stageControls.totalSteps) * 100
  return {
    ...draft,
    ...stageControls,
    ...buildingControls,
    ...saveControls,
    error,
    setError,
    conflict,
    setConflict,
    findings,
    setFindings,
    checking,
    setChecking,
    conflictCheckEnabled,
    definitionOverride,
    initialProfile,
    initialProfileVersion,
    initialStep,
    locale,
    mode,
    progress,
    projectId,
    projectName,
    router,
    salvageNotice,
    t,
  }
}

export type ProjectIntakeWizardController = ReturnType<typeof useProjectIntakeWizardController>

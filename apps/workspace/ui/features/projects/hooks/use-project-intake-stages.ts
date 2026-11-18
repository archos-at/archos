import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { motionEntrance, useMotionToken } from '@/components/motion'
import { answerKeyFor, modeKeyFor, type BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import { evaluateIntakeCondition, isIntakeAnswerProvided, pruneStaleConditionalAnswers } from '@/lib/project-profile/intake-conditions'
import type { ConsistencyFinding } from '@/lib/project-profile/intake-consistency'
import type { IntakeAnswerMode, ProjectIntakeDefinition, ProjectIntakeQuestion, ProjectIntakeStage } from '@/lib/project-profile/intake-types'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'

import { zoneQuestionsFor } from '../components/project-intake-buildings'
import { isQuestionSatisfied, type Answers } from '../components/project-intake-helpers'
import { quickStartQuestions, visibleStageQuestions } from '../lib/project-intake-stage-questions'

interface UseProjectIntakeStagesOptions {
  definition: ProjectIntakeDefinition | null
  answers: Answers
  setAnswers: Dispatch<SetStateAction<Answers>>
  buildings: BuildingInstance[]
  currentStep: number
  setCurrentStep: Dispatch<SetStateAction<number>>
  setError: Dispatch<SetStateAction<string | null>>
  setConflict: Dispatch<SetStateAction<boolean>>
  setFindings: Dispatch<SetStateAction<ConsistencyFinding[] | null>>
}

export function useProjectIntakeStages({
  definition,
  answers,
  setAnswers,
  buildings,
  currentStep,
  setCurrentStep,
  setError,
  setConflict,
  setFindings,
}: UseProjectIntakeStagesOptions) {
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [quickStart, setQuickStart] = useState(false)
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  const stages = useMemo(() => definition?.stages ?? [], [definition])
  const totalSteps = stages.length
  const stage: ProjectIntakeStage | null = stages[currentStep] ?? null
  const isReview = stage?.id === 'H'
  const isBasis = stage?.id === 'I'

  const setAnswer = useCallback(
    (key: string, value: ProjectPrimitiveValue) => {
      setAnswers((prev) => pruneStaleConditionalAnswers({ ...prev, [key]: value }, definition))
      setFindings(null)
      setTouched((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    },
    [definition, setAnswers, setFindings]
  )

  const setMode = useCallback(
    (answerKey: string, nextMode: IntakeAnswerMode) => {
      setAnswers((prev) => {
        const next = { ...prev, [modeKeyFor(answerKey)]: nextMode }
        if (nextMode === 'open') delete next[answerKey]
        return pruneStaleConditionalAnswers(next, definition)
      })
      setFindings(null)
    },
    [definition, setAnswers, setFindings]
  )

  const stageVisibleQuestions = useMemo(() => {
    if (!stage || stage.scope === 'building') return []
    return visibleStageQuestions(stage, answers)
  }, [stage, answers])

  const stageQuickStarted = quickStart && stage != null && !expandedStages.has(stage.id)

  const flatVisibleQuestions = useMemo(() => {
    if (!stageQuickStarted) return stageVisibleQuestions
    return quickStartQuestions(stageVisibleQuestions)
  }, [stageQuickStarted, stageVisibleQuestions])

  const hiddenByQuickStart = stageVisibleQuestions.length - flatVisibleQuestions.length

  const quickStartStage = useMemo(() => {
    if (!stage) return stage
    if (!stageQuickStarted) return stage
    return { ...stage, questions: quickStartQuestions(stage.questions) }
  }, [stage, stageQuickStarted])

  const stageValid = useMemo(() => {
    if (!stage) return true
    if (stage.scope === 'building') {
      return buildings.every((bw) =>
        stage.questions
          .filter((q) => evaluateIntakeCondition(q, answers, bw.id))
          .every((q) => isQuestionSatisfied(q, answers, answerKeyFor(q.id, bw.id)))
      )
    }
    return stageVisibleQuestions.every((q) => isQuestionSatisfied(q, answers, q.id))
  }, [stage, buildings, answers, stageVisibleQuestions])

  const stageProgress = useMemo(() => {
    const counts = new Map<string, { answered: number; total: number }>()
    for (const s of stages) {
      let answered = 0
      let total = 0
      const tally = (q: ProjectIntakeQuestion, key: string) => {
        if (q.type === 'info_placeholder' || q.type === 'document_role' || q.type === 'upload')
          return
        total += 1
        if (isIntakeAnswerProvided(answers[key]) || answers[modeKeyFor(key)] === 'open')
          answered += 1
      }
      if (s.scope === 'building') {
        for (const bw of buildings) {
          for (const q of s.questions) {
            if (evaluateIntakeCondition(q, answers, bw.id)) tally(q, answerKeyFor(q.id, bw.id))
          }
          for (const zone of zoneQuestionsFor(s, bw.id, answers)) {
            tally(zone.question, answerKeyFor(zone.question.id, bw.id, zone.use))
          }
        }
      } else {
        for (const q of s.questions) {
          if (evaluateIntakeCondition(q, answers)) tally(q, q.id)
        }
      }
      counts.set(s.id, { answered, total })
    }
    return counts
  }, [stages, answers, buildings])

  const skipRestOfStage = useCallback(() => {
    if (!stage) return
    setAnswers((prev) => {
      const next = { ...prev }
      const markOpen = (q: ProjectIntakeQuestion, key: string) => {
        if (q.type === 'info_placeholder' || q.type === 'document_role' || q.type === 'upload')
          return
        if (q.required) return
        if (isIntakeAnswerProvided(next[key])) return
        if (q.type === 'yes_no_open') {
          next[key] = 'open'
          return
        }
        next[modeKeyFor(key)] = 'open'
        delete next[key]
      }
      if (stage.scope === 'building') {
        for (const bw of buildings) {
          for (const q of stage.questions) {
            if (evaluateIntakeCondition(q, next, bw.id)) markOpen(q, answerKeyFor(q.id, bw.id))
          }
          for (const zone of zoneQuestionsFor(stage, bw.id, next)) {
            markOpen(zone.question, answerKeyFor(zone.question.id, bw.id, zone.use))
          }
        }
      } else {
        for (const q of stage.questions) {
          if (evaluateIntakeCondition(q, next)) markOpen(q, q.id)
        }
      }
      return pruneStaleConditionalAnswers(next, definition)
    })
    setFindings(null)
  }, [stage, buildings, definition, setAnswers, setFindings])

  const directionRef = useRef(1)
  const stepEnter = useMotionToken(motionEntrance)

  const goToStep = useCallback(
    (step: number) => {
      setError(null)
      setConflict(false)
      setFindings(null)
      setCurrentStep((prev) => {
        const next = Math.max(0, Math.min(step, totalSteps - 1))
        directionRef.current = next >= prev ? 1 : -1
        return next
      })
    },
    [totalSteps, setError, setConflict, setFindings, setCurrentStep]
  )

  const markStageTouched = useCallback(() => {
    if (!stage) return
    setTouched((prev) => {
      const next = new Set(prev)
      if (stage.scope === 'building') {
        for (const bw of buildings) {
          for (const q of stage.questions) {
            const key = answerKeyFor(q.id, bw.id)
            if (evaluateIntakeCondition(q, answers, bw.id) && !isQuestionSatisfied(q, answers, key))
              next.add(key)
          }
        }
      } else {
        for (const q of stageVisibleQuestions) {
          if (!isQuestionSatisfied(q, answers, q.id)) next.add(q.id)
        }
      }
      return next
    })
  }, [stage, buildings, answers, stageVisibleQuestions])

  const handleNext = useCallback(() => {
    if (!stageValid) {
      markStageTouched()
      return
    }
    goToStep(currentStep + 1)
  }, [stageValid, markStageTouched, goToStep, currentStep])

  return {
    touched,
    setTouched,
    quickStart,
    setQuickStart,
    expandedStages,
    setExpandedStages,
    stages,
    totalSteps,
    stage,
    isReview,
    isBasis,
    setAnswer,
    setMode,
    stageVisibleQuestions,
    stageQuickStarted,
    flatVisibleQuestions,
    hiddenByQuickStart,
    quickStartStage,
    stageValid,
    stageProgress,
    skipRestOfStage,
    directionRef,
    stepEnter,
    goToStep,
    markStageTouched,
    handleNext,
  }
}



import { PencilLine, Plus, Trash2 } from 'lucide-react'


import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'

import { answerKeyFor, buildingNumber, buildingTag } from '@/lib/project-profile/intake-building-keys'
import { evaluateIntakeCondition } from '@/lib/project-profile/intake-conditions'

import type { BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import type { IntakeAnswerMode, ProjectIntakeQuestion, ProjectIntakeStage } from '@/lib/project-profile/intake-types'

import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { useTranslations } from '@/i18n'

import { projectsCopy } from '@/i18n/namespaces/projects'
import { Answers, isQuestionSatisfied } from './project-intake-helpers'

import { QuestionField } from './project-intake-fields'

export function zoneQuestionsFor(
  stage: ProjectIntakeStage,
  buildingId: string,
  answers: Answers
): Array<{ question: ProjectIntakeQuestion; use: string }> {
  if (!stage.zoneCommon && !stage.zoneDefinitions) return []
  const selected = answers[answerKeyFor('D0', buildingId)]
  if (!Array.isArray(selected)) return []
  const out: Array<{ question: ProjectIntakeQuestion; use: string }> = []
  for (const use of selected) {
    const key = String(use)
    for (const question of [
      ...(stage.zoneCommon ?? []),
      ...(stage.zoneDefinitions?.[key]?.questions ?? []),
    ]) {
      out.push({ question, use: key })
    }
  }
  return out
}

export function maxBuildingNumber(buildings: BuildingInstance[]): number {
  return buildings.reduce((max, bw) => {
    const n = buildingNumber(bw.id)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 1)
}

export function BuildingStage({
  stage,
  buildings,
  answers,
  touched,
  projectId,
  onSetAnswer,
  onSetMode,
  onAddBuilding,
  onRemoveBuilding,
  onRenameBuilding,
  validationMessageFor,
}: {
  stage: ProjectIntakeStage
  buildings: BuildingInstance[]
  answers: Answers
  touched: Set<string>
  projectId: string
  onSetAnswer: (key: string, value: ProjectPrimitiveValue) => void
  onSetMode: (key: string, mode: IntakeAnswerMode) => void
  onAddBuilding: () => void
  onRemoveBuilding: (id: string) => void
  onRenameBuilding: (id: string, name: string) => void
  validationMessageFor: (q: ProjectIntakeQuestion) => string
}) {
  const t = useTranslations(projectsCopy)
  const canManage = stage.id === 'C'

  return (
    <div className="space-y-4">
      {buildings.map((bw, index) => (
        <div key={bw.id} className="bg-card overflow-hidden rounded-surface shadow-xs">
          <div className="bg-muted/40 flex items-center gap-3 border-b px-4 py-2.5">
            <Badge variant="default" className="font-mono">
              {buildingTag(bw.id)}
            </Badge>
            {canManage ? (
              <>
              <input
                value={bw.name}
                onChange={(e) => onRenameBuilding(bw.id, e.target.value)}
                aria-label={t('intake.building.nameAria')}
                enterKeyHint="done"
                className="hover:border-border focus:border-primary min-w-0 flex-1 border-b border-dashed border-transparent bg-transparent py-0.5 text-sm font-medium outline-none pointer-coarse:border-border pointer-coarse:py-2.5 pointer-coarse:text-base"
              />
              <PencilLine className="text-muted-foreground -ml-1 hidden size-3.5 shrink-0 pointer-coarse:block" aria-hidden />
              </>
            ) : (
              <span className="flex-1 truncate text-sm font-medium">{bw.name}</span>
            )}
            {canManage && buildings.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveBuilding(bw.id)}
                className="text-muted-foreground hover:text-destructive h-auto gap-1 px-2 py-1 text-xs"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {t('intake.building.remove')}
              </Button>
            )}
          </div>

          <div className="space-y-6 px-4 py-5 md:px-6">
            {(() => {
              const visible = stage.questions.filter((q) =>
                evaluateIntakeCondition(q, answers, bw.id)
              )
              let openGroup: string | undefined
              return visible.map((q) => {
                const answerKey = answerKeyFor(q.id, bw.id)
                const heading = q.group && q.group !== openGroup ? q.group : null
                if (q.group) openGroup = q.group
                return (
                  <div key={answerKey} className={heading ? 'space-y-6 pt-2' : undefined}>
                    {heading && (
                      <SectionLabel as="h3" className="border-b pb-2">
                        {heading}
                      </SectionLabel>
                    )}
                    <QuestionField
                      question={q}
                      answerKey={answerKey}
                      answers={answers}
                      projectId={projectId}
                      error={
                        touched.has(answerKey) && !isQuestionSatisfied(q, answers, answerKey)
                          ? validationMessageFor(q)
                          : null
                      }
                      onSetAnswer={onSetAnswer}
                      onSetMode={onSetMode}
                    />
                  </div>
                )
              })
            })()}

            {/* Module D: implicit use-zones expanded from D0. */}
            {stage.id === 'D' && (
              <ZoneBlocks
                stage={stage}
                bw={bw}
                answers={answers}
                onSetAnswer={onSetAnswer}
                onSetMode={onSetMode}
                projectId={projectId}
              />
            )}
          </div>
          {index === buildings.length - 1 && canManage && (
            <div className="border-t px-4 py-3 md:px-6">
              <button data-attr="project-add-building"
                type="button"
                onClick={onAddBuilding}
                className="border-border text-muted-foreground hover:border-primary/60 hover:bg-hover hover:text-primary inline-flex w-full items-center justify-center gap-2 rounded-control border border-dashed py-2.5 font-mono text-xs pointer-coarse:min-h-11 transition-colors duration-quick ease-out motion-reduce:transition-none"
              >
                <Plus className="size-4" aria-hidden />
                {t('intake.building.add')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function ZoneBlocks({
  stage,
  bw,
  answers,
  onSetAnswer,
  onSetMode,
  projectId,
}: {
  stage: ProjectIntakeStage
  bw: BuildingInstance
  answers: Answers
  onSetAnswer: (key: string, value: ProjectPrimitiveValue) => void
  onSetMode: (key: string, mode: IntakeAnswerMode) => void
  projectId: string
}) {
  const selected = answers[answerKeyFor('D0', bw.id)]
  if (!Array.isArray(selected) || selected.length === 0) return null
  const d0 = stage.questions.find((q) => q.id === 'D0')

  return (
    <>
      {selected.map((use) => {
        const label = d0?.options?.find((o) => o.value === use)?.label ?? use
        const zoneQuestions = [
          ...(stage.zoneCommon ?? []),
          ...(stage.zoneDefinitions?.[use]?.questions ?? []),
        ]
        if (zoneQuestions.length === 0) return null
        return (
          <div key={use} className="bg-muted rounded-surface border px-4 py-4">
            <p className="card-eyebrow text-primary mb-3 font-mono">
              Zone · {label}
            </p>
            <div className="space-y-5">
              {zoneQuestions.map((q) => {
                const answerKey = answerKeyFor(q.id, bw.id, use)
                return (
                  <QuestionField
                    key={answerKey}
                    question={q}
                    answerKey={answerKey}
                    answers={answers}
                    projectId={projectId}
                    error={null}
                    onSetAnswer={onSetAnswer}
                    onSetMode={onSetMode}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

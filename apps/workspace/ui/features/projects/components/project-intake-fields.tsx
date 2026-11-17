

import Link from 'next/link'

import { FolderOpen, Sparkles } from 'lucide-react'


import { Badge } from '@/components/ui/badge'

import { DocumentRoleField } from './document-role-field'
import { QuestionControl, QuestionHeader } from './intake-question-field'

import { buildingIdFromAnswerKey } from '@/lib/project-profile/intake-building-keys'

import type { IntakeAnswerMode, ProjectIntakeQuestion } from '@/lib/project-profile/intake-types'

import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { useTranslations } from '@/i18n'

import { projectsCopy } from '@/i18n/namespaces/projects'
import { Answers } from './project-intake-helpers'

export function QuestionField({
  question,
  answerKey,
  answers,
  projectId,
  error,
  onSetAnswer,
  onSetMode,
}: {
  question: ProjectIntakeQuestion
  answerKey: string
  answers: Answers
  projectId: string
  error: string | null
  onSetAnswer: (key: string, value: ProjectPrimitiveValue) => void
  onSetMode: (key: string, mode: IntakeAnswerMode) => void
}) {
  const domId = `q-${answerKey}`

  if (question.type === 'info_placeholder') {
    return <InfoPlaceholder question={question} />
  }
  if (question.type === 'upload') {
    return <UploadField question={question} projectId={projectId} />
  }
  if (question.type === 'document_role') {
    if (!question.role) return <UploadField question={question} projectId={projectId} />
    return (
      <div className="flex flex-col gap-2">
        <QuestionHeader question={question} domId={domId} />
        <DocumentRoleField
          projectId={projectId}
          role={question.role}
          scopeInstanceId={buildingIdFromAnswerKey(answerKey)}
        />
      </div>
    )
  }
  return (
    <QuestionControl
      question={question}
      answerKey={answerKey}
      answers={answers}
      error={error}
      onSetAnswer={onSetAnswer}
      onSetMode={onSetMode}
    />
  )
}

export function UploadField({
  question,
  projectId,
}: {
  question: ProjectIntakeQuestion
  projectId: string
}) {
  const t = useTranslations(projectsCopy)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{question.label}</span>
      <Link
        href={`/app/projects/${projectId}/files`}
        className="border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-desk hover:text-foreground inline-flex max-w-md items-center gap-3 rounded-control border border-dashed px-4 py-3 text-sm transition-colors duration-quick ease-out motion-reduce:transition-none"
      >
        <FolderOpen className="text-primary size-4 shrink-0" aria-hidden />
        <span>{t('intake.upload.hint')}</span>
      </Link>
    </div>
  )
}

export function InfoPlaceholder({ question }: { question: ProjectIntakeQuestion }) {
  const t = useTranslations(projectsCopy)
  return (
    <div className="bg-muted/30 rounded-surface border border-dashed px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <Sparkles className="text-primary size-4 shrink-0 translate-y-0.5" aria-hidden />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{question.label}</p>
            <Badge variant="info">{t('intake.derived.badge')}</Badge>
          </div>
          {question.hint && <p className="text-muted-foreground mt-1 text-xs">{question.hint}</p>}
        </div>
      </div>
    </div>
  )
}

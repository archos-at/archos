'use client'

import type { FC } from 'react'
import { Card } from '@/components/ui/card'
import { SectionLabel } from '@/components/ui/section-label'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { CARD_SHELL } from './card-chrome'
import { ClampedText } from './ClampedText'

const KIND_LABEL = {
  compliance_check: 'complianceCheck',
  submission_check: 'submissionCheck',
  document: 'document',
  revision: 'revision',
} as const

interface TaskCreatedCardProps {
  taskId: string
  kind: keyof typeof KIND_LABEL
  title: string
  goal: string
  dueAt?: string | null
  conversationId?: string | null
}

export const TaskCreatedCard: FC<TaskCreatedCardProps> = ({
  taskId,
  kind,
  title,
  goal,
  dueAt,
}) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()

  const due = dueAt ? new Date(dueAt) : null
  const dueLabel =
    due && !Number.isNaN(due.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(due)
      : null

  return (
    <Card data-testid="task-created-card" data-task-id={taskId} className={cn(CARD_SHELL, 'gap-2 p-5')}>
      <SectionLabel>{t('cards.taskCreated.eyebrow')}</SectionLabel>

      <div className="flex min-w-0 flex-col">
        <ClampedText className="card-title text-foreground">{title}</ClampedText>
        {/* The requester's own sentence, under the title the engine gave it.
            Two lines rather than one because the title is what the task LIST
            will call it and the goal is what the person actually said. */}
        <p className="card-caption text-muted-foreground">
          {goal}
        </p>
      </div>

      <p className="card-caption flex flex-wrap items-center gap-x-3 text-muted-foreground">
        <span className="flex items-center gap-x-2">
          <span data-testid="task-created-kind">
            {t(`cards.taskCreated.kind.${KIND_LABEL[kind]}` as 'cards.taskCreated.kind.submissionCheck')}
          </span>
          {dueLabel && (
            <>
              <span aria-hidden className="text-muted-foreground/40">
                ·
              </span>
              <span data-testid="task-created-due">{t('cards.taskCreated.due', { date: dueLabel })}</span>
            </>
          )}
        </span>

      </p>
    </Card>
  )
}

'use client'

import type { FC } from 'react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { AnswerMetaWorkItem } from '@/lib/conversations/message-answer-meta'

interface WorkReportCardProps {
  done?: AnswerMetaWorkItem[]
  proposed?: AnswerMetaWorkItem[]
  blocked?: AnswerMetaWorkItem[]
  next?: AnswerMetaWorkItem[]
}

const ORDER = ['proposed', 'blocked', 'next', 'done'] as const

const WorkLine: FC<{ item: AnswerMetaWorkItem }> = ({ item }) => {
  const t = useTranslations(chatCopy)
  const meta = [
    item.who ? t('cards.workReport.who', { who: item.who }) : null,
    item.due ? t('cards.workReport.due', { due: item.due }) : null,
  ].filter((part): part is string => Boolean(part))
  return (
    <li className="card-body text-pretty text-foreground">
      {item.text}
      {meta.length > 0 && <span className="card-caption text-muted-foreground"> · {meta.join(' · ')}</span>}
    </li>
  )
}

export const WorkReportCard: FC<WorkReportCardProps> = (props) => {
  const t = useTranslations(chatCopy)
  const sections = ORDER.map((section) => ({ section, items: (props[section] ?? []).filter((item) => item?.text) })).filter(
    ({ items }) => items.length > 0
  )
  if (sections.length === 0) return null
  return (
    <section className="flex flex-col gap-3 rounded-surface bg-muted/40 px-4 py-3" aria-label={t('cards.workReport.eyebrow')}>
      <SectionLabel as="h3">{t('cards.workReport.eyebrow')}</SectionLabel>
      {sections.map(({ section, items }) => (
        <div key={section} className="flex flex-col gap-1" data-testid={`work-report-${section}`}>
          <SectionLabel as="h4">{t(`cards.workReport.${section}`)}</SectionLabel>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {items.map((item, index) => (
              <WorkLine key={`${item.text}-${index}`} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

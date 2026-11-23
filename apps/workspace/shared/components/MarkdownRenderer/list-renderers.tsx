'use client'

import { Circle, CircleCheck } from 'lucide-react'
import type { ExtraProps } from 'react-markdown'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { ListCase, MarkChip, StepList } from './answer-atoms'
import { StepItem } from './directive-blocks'
import { CasesScope, hasCases, useCasesDecision } from './project-binding'
import { useCaseMarks } from './case-marks'
import { useMarkdownRenderState } from './render-state-context'

export function MarkdownListItem({ children, id, node }: React.ComponentPropsWithoutRef<'li'> & ExtraProps) {
  const { compact } = useMarkdownRenderState()
  const { active, muted } = useCaseMarks(node?.properties)
  const t = useTranslations(commonCopy)
  const decided = useCasesDecision() !== null && node?.properties?.dataCaseIndex !== undefined
  if (node?.properties?.dataPhase) return <StepItem node={node}>{children}</StepItem>
  if (active || muted) {
    return (
      <ListCase id={id} active={active} muted={muted} compact={compact}>
        {children}
        {active && decided && <MarkChip>{t('markdown.caseApplies')}</MarkChip>}
      </ListCase>
    )
  }
  return (
    <li id={id} className={`text-foreground ${compact ? 'text-sm' : 'text-answer'}`}>
      {children}
    </li>
  )
}

export function MarkdownTaskMark({ type, checked }: React.ComponentPropsWithoutRef<'input'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  if (type !== 'checkbox') return null
  const Mark = checked ? CircleCheck : Circle
  return (
    <span
      className="mr-2 inline-flex translate-y-[3px] align-top"
      data-testid="task-mark"
      data-done={checked ? 'true' : 'false'}
    >
      <Mark aria-hidden="true" className={checked ? 'text-success size-4' : 'text-muted-foreground size-4'} />
      <span className="sr-only">{checked ? t('markdown.taskDone') : t('markdown.taskOpen')}</span>
    </span>
  )
}

export function MarkdownUnorderedList({ children, className: listClassName, node }: React.ComponentPropsWithoutRef<'ul'> & ExtraProps) {
  if (node?.properties?.dataVariant === 'steps') return <StepList ordered={false}>{children}</StepList>
  const list = (
    <ul
      className={
        listClassName?.includes('contains-task-list')
          ? 'text-foreground mb-3 max-w-[72ch] list-none space-y-1 pl-1'
          : 'text-foreground mb-3 max-w-[72ch] list-outside list-disc space-y-1 pl-5'
      }
    >
      {children}
    </ul>
  )
  return hasCases(node) ? <CasesScope node={node}>{list}</CasesScope> : list
}

export function MarkdownOrderedList({ children, node }: React.ComponentPropsWithoutRef<'ol'> & ExtraProps) {
  if (node?.properties?.dataVariant === 'steps') return <StepList ordered>{children}</StepList>
  const list = <ol className="text-foreground mb-3 max-w-[72ch] list-outside list-decimal space-y-1 pl-5">{children}</ol>
  return hasCases(node) ? <CasesScope node={node}>{list}</CasesScope> : list
}

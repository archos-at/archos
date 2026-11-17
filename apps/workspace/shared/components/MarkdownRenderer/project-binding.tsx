'use client'

import { createContext, useContext, useMemo, type FC, type ReactNode } from 'react'
import type { Element } from 'hast'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import type { ProjectKey } from '@/lib/text/answer-directives'
import { isProjectKey } from '@/lib/text/answer-directives'
import { formatFigure, unitFor, type BoundFact } from '@/lib/project-profile/answer-bindings'
import { CaseProjectLine, ProjectStrip, ProjectValueChip, StripSeparator, ThresholdRuler } from './answer-atoms'
import { useAnswerData } from './answer-block-context'
import { matchCase, rulerOf, type CaseDescriptor } from './cases'

export function useProjectLabel(): (key: ProjectKey) => string {
  const t = useTranslations(commonCopy)
  return (key) => t(`markdown.project.keys.${key}`)
}

export const ProjectFactChip: FC<{ factKey: ProjectKey; strip?: boolean }> = ({ factKey, strip = false }) => {
  const t = useTranslations(commonCopy)
  const { project, prefill } = useAnswerData()
  const label = useProjectLabel()(factKey)
  if (!project) return <span data-testid="project-value" data-state="unbound">{label}</span>
  const fact = project(factKey)
  const onFill = prefill ? () => prefill(t('markdown.project.fillRequest', { label })) : undefined
  const text = fact.text ?? label
  return (
    <ProjectValueChip state={fact.state} label={label} reason={fact.reason} onFill={onFill}>
      {strip && fact.state !== 'missing' ? t(`markdown.project.stripFact.${factKey}`, { value: text }) : text}
    </ProjectValueChip>
  )
}

export function AnswerProject({ node, children }: { node?: Element; children?: ReactNode }) {
  const key = String(node?.properties?.dataKey ?? '')
  return isProjectKey(key) ? <ProjectFactChip factKey={key} /> : <>{children}</>
}

export const AnswerProjectStrip: FC<{ keys: readonly ProjectKey[] }> = ({ keys }) => {
  const { project } = useAnswerData()
  if (!project || keys.length === 0) return null
  return (
    <ProjectStrip>
      {keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-1">
          {index > 0 && <StripSeparator />}
          <ProjectFactChip factKey={key} strip />
        </span>
      ))}
    </ProjectStrip>
  )
}

export interface CasesDecision {
  match: number
}

const CasesContext = createContext<CasesDecision | null>(null)

export const useCasesDecision = (): CasesDecision | null => useContext(CasesContext)

function parseList<T>(value: unknown): T[] | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : null
  } catch {
    return null
  }
}

function casesOf(node: Element | undefined): { by: ProjectKey; cases: CaseDescriptor[]; labels: string[] } | null {
  const by = String(node?.properties?.dataBy ?? '')
  const cases = parseList<CaseDescriptor>(node?.properties?.dataCases)
  if (!isProjectKey(by) || !cases) return null
  return { by, cases, labels: parseList<string>(node?.properties?.dataCaseLabels) ?? [] }
}

const decide = (cases: readonly CaseDescriptor[], fact: BoundFact): number =>
  fact.state === 'missing' ? -1 : matchCase(cases, { number: fact.number, text: fact.text })

export const CasesScope: FC<{ node?: Element; children: ReactNode }> = ({ node, children }) => {
  const { project } = useAnswerData()
  const label = useProjectLabel()
  const parsed = useMemo(() => casesOf(node), [node])
  const fact = parsed && project ? project(parsed.by) : null
  const match = parsed && fact ? decide(parsed.cases, fact) : null
  const decision = useMemo(() => (match === null ? null : { match }), [match])
  if (!parsed || !fact || !decision) return <>{children}</>
  const unit = unitFor(parsed.by)
  const ruler = fact.number !== null && parsed.cases.every((entry) => entry.kind === 'range') ? rulerOf(parsed.cases, parsed.labels, fact.number) : null
  return (
    <CasesContext.Provider value={decision}>
      <div className="my-4 flex flex-col gap-2 [&>div]:my-0" data-testid="cases-scope" data-match={decision.match}>
        <CaseProjectLine>
          <ProjectFactChip factKey={parsed.by} />
        </CaseProjectLine>
        {ruler && fact.text && (
          <ThresholdRuler
            ruler={ruler}
            valueText={fact.text}
            label={label(parsed.by)}
            format={(value) => formatFigure(value, unit)}
          />
        )}
        {children}
      </div>
    </CasesContext.Provider>
  )
}

export const hasCases = (node: Element | undefined): boolean => typeof node?.properties?.dataCases === 'string'

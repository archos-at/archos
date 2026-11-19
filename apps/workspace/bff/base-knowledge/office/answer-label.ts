import type { BaseKnowledgeEntry } from '../wire'
import { directiveApplicability, type DirectiveApplicability, type ProjectTerritory } from './authority'

export type AnswerRole = 'requirement_source' | 'interpretation' | 'authority_practice'

export type OfficeFreshness = 'current' | 'check_due' | 'newer_known' | 'superseded'

export interface OfficeAnswerLabel {
  editionId: string
  workId: string
  documentId: string
  fileName: string
  kind: BaseKnowledgeEntry['values']['kind']
  designation: string | null
  title: string
  editionLabel: string
  holder: 'office'
  role: AnswerRole
  lastCheckedOn: string | null
  checkOverdue: boolean
  freshness: OfficeFreshness
  textUse: BaseKnowledgeEntry['textUse']
  directive: DirectiveApplicability | null
}

const checkDue = (entry: BaseKnowledgeEntry) => entry.freshness.overdue && !entry.binding?.held

function freshnessOf(entry: BaseKnowledgeEntry): OfficeFreshness {
  if (entry.binding?.held) return 'current'
  const result = entry.freshness.lastCheck?.result
  if (result === 'newer_known') return 'newer_known'
  if (result === 'withdrawn') return 'superseded'
  return checkDue(entry) ? 'check_due' : 'current'
}

function roleOf(kind: BaseKnowledgeEntry['values']['kind']): AnswerRole {
  if (kind === 'commentary') return 'interpretation'
  if (kind === 'authority_directive') return 'authority_practice'
  return 'requirement_source'
}

export function officeAnswerLabel(entry: BaseKnowledgeEntry, project: ProjectTerritory): OfficeAnswerLabel {
  const { values } = entry
  return {
    editionId: entry.editionId,
    workId: entry.workId,
    documentId: entry.documentId,
    fileName: entry.fileName,
    kind: values.kind,
    designation: values.designation,
    title: values.title,
    editionLabel: values.editionLabel,
    holder: 'office',
    role: roleOf(values.kind),
    lastCheckedOn: entry.freshness.lastCheck?.checkedAt.slice(0, 10) ?? null,
    checkOverdue: checkDue(entry),
    freshness: freshnessOf(entry),
    textUse: entry.textUse,
    directive: values.kind === 'authority_directive' ? directiveApplicability(values.addressees, project) : null,
  }
}

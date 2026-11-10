/**
 * The data of the label an answer puts on a passage from the office's own copy
 * (ADR-0158, design §0: "Norm, Büroexemplar Ausgabe 2017, zuletzt geprüft am
 * 12.09.2026"). This layer supplies the data; the answer's renderer (S2) words
 * it. Pure. Tokens only, no prose: the renderer chooses the language.
 */

import type { BaseKnowledgeEntry } from '../wire'
import { directiveApplicability, type DirectiveApplicability, type ProjectTerritory } from './authority'

export type AnswerRole = 'requirement_source' | 'interpretation' | 'authority_practice'

export interface OfficeAnswerLabel {
  documentId: string
  fileName: string
  kind: BaseKnowledgeEntry['values']['kind']
  designation: string | null
  title: string
  editionLabel: string
  /** Whose copy the passage comes from: always the office's here; the platform's labels come with S7. */
  holder: 'office'
  role: AnswerRole
  /** The day of the last check (YYYY-MM-DD), or null when never checked. */
  lastCheckedOn: string | null
  checkOverdue: boolean
  textUse: BaseKnowledgeEntry['textUse']
  /** For a directive: whether it applies to this project's authority. */
  directive: DirectiveApplicability | null
}

function roleOf(kind: BaseKnowledgeEntry['values']['kind']): AnswerRole {
  if (kind === 'commentary') return 'interpretation'
  if (kind === 'authority_directive') return 'authority_practice'
  return 'requirement_source'
}

export function officeAnswerLabel(entry: BaseKnowledgeEntry, project: ProjectTerritory): OfficeAnswerLabel {
  const { values } = entry
  return {
    documentId: entry.documentId,
    fileName: entry.fileName,
    kind: values.kind,
    designation: values.designation,
    title: values.title,
    editionLabel: values.editionLabel,
    holder: 'office',
    role: roleOf(values.kind),
    lastCheckedOn: entry.freshness.lastCheck?.checkedAt.slice(0, 10) ?? null,
    checkOverdue: entry.freshness.overdue,
    textUse: entry.textUse,
    directive: values.kind === 'authority_directive' ? directiveApplicability(values.addressees, project) : null,
  }
}

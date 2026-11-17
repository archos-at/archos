import type { ChatMessage } from '@/features/chat/types'
import type { Finding, Findings, FindingStatus } from '@/lib/conversations/message-findings'
import {
  MAX_PLAN_DOCUMENTS,
  type PlanDocument,
  type PlanDocuments,
} from '@/lib/runs/plan-documents'

export interface RunBrief {
  question: string
  context?: string
  documents?: PlanDocuments
}

const STATUS_WORD: Record<FindingStatus, string> = {
  met: 'erfüllt',
  not_met: 'nicht erfüllt',
  open: 'offen',
  not_applicable: 'nicht anwendbar',
}

const findingLine = (finding: Finding): string => {
  const parts = [finding.requirement]
  if (finding.value) parts.push(finding.value)
  if (finding.status) parts.push(STATUS_WORD[finding.status])
  if (finding.reference) {
    parts.push([finding.reference.document, finding.reference.section].filter(Boolean).join(' '))
  }
  return `- ${parts.join(' — ')}${finding.comment ? ` (${finding.comment})` : ''}`
}

export function findingBrief(finding: Finding): RunBrief {
  const question = `Klären: ${finding.requirement}`
  const context = [
    'Offener Befund aus dem letzten Bericht:',
    findingLine(finding),
    'Ermitteln Sie, was den Befund entscheidet, und schreiben Sie ihn mit Wert, Fundstelle und Status fort.',
  ].join('\n')
  return { question, context }
}

export function reportDocuments(message: ChatMessage): PlanDocument[] {
  const out: PlanDocument[] = []
  const seen = new Set<string>()
  for (const source of message.citations ?? []) {
    if (source.shelf !== 'project' && source.shelf !== 'office_shelf') continue
    const name = source.fileName?.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase()
    if (seen.has(key) || out.length >= MAX_PLAN_DOCUMENTS) continue
    seen.add(key)
    const title = source.title?.trim()
    out.push({ name, ...(title && title !== name ? { title } : {}), shelf: source.shelf })
  }
  return out
}

export function continuationBrief(message: ChatMessage): RunBrief {
  const title = message.runTitle?.trim() || 'Bericht'
  const question = `Fortschreibung: ${title}`
  const lines = message.findings?.items.map(findingLine) ?? []
  const context = [
    'Fortschreibung des bisherigen Berichts. Bisherige Befunde:',
    ...(lines.length > 0 ? lines : ['(keine Befundliste vorhanden)']),
    'Prüfen Sie jeden Befund gegen den aktuellen Projektstand, kennzeichnen Sie, was sich geändert hat, und schließen Sie offene Punkte, wo die Quellen es erlauben.',
  ].join('\n')
  const basis = reportDocuments(message)
  return basis.length > 0
    ? { question, context, documents: { basis: basis, excluded: [] } }
    : { question, context }
}

export function previousRunFindings(
  messages: readonly ChatMessage[],
  messageId: string
): Findings | undefined {
  const index = messages.findIndex((message) => message.id === messageId)
  for (let i = (index === -1 ? messages.length : index) - 1; i >= 0; i--) {
    const candidate = messages[i]
    if (candidate?.runLedger && candidate.findings) return candidate.findings
  }
  return undefined
}

import type { InboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import type { InboundMailDecision, InboundMailPartDecision, InboundMailThreadTarget, InboundMailView } from './inbound-mail-wire'
import { defaultThread, revisionVouched, senderFactsOfView } from './review-defaults'
import { modelSuggestion } from './sender-memory'
import { displaySubject } from './subject'
import type { InboundMailSuggestion } from './suggest'

export interface FolderChoice {
  folderId: string | null
}

function suggestedTarget(suggestion: InboundMailSuggestion): { folderId: string | null; newFolderPath: string | null } {
  if (suggestion.folderId && !suggestion.newFolder) return { folderId: suggestion.folderId, newFolderPath: null }
  return { folderId: null, newFolderPath: suggestion.folderPath }
}

function clean(part: { preselected: boolean }, row: InboundMailPartRow | undefined): boolean {
  return part.preselected && !!row && row.riskFlags.length === 0 && row.contentFindings.length === 0
}

function textFolder(
  view: InboundMailView,
  correspondence: FolderChoice | null,
): { folderId: string | null; newFolderPath: string | null } {
  const suggestion = modelSuggestion(view.parts.find((part) => part.kind === 'message')?.suggestion ?? null)
  if (suggestion) return suggestedTarget(suggestion)
  return { folderId: correspondence?.folderId ?? null, newFolderPath: null }
}

function attachmentDecisions(
  view: InboundMailView,
  rows: ReadonlyMap<string, InboundMailPartRow>,
  correspondence: FolderChoice | null,
): InboundMailPartDecision[] {
  const sender = senderFactsOfView(view)
  const decisions: InboundMailPartDecision[] = []
  for (const part of view.parts) {
    if (part.kind !== 'attachment' || !part.filename || !clean(part, rows.get(part.id))) continue
    const suggestion = modelSuggestion(part.suggestion)
    const documentType = suggestion?.documentType ?? undefined
    if (part.revisionCandidate && revisionVouched(part, sender)) {
      decisions.push({ partId: part.id, folderId: null, newFolderPath: null, name: part.filename, revisionOf: part.revisionCandidate.documentId, documentType })
    } else {
      const target = suggestion ? suggestedTarget(suggestion) : textFolder(view, correspondence)
      decisions.push({ partId: part.id, ...target, name: part.filename, documentType })
    }
  }
  return decisions
}

function messageDecision(
  view: InboundMailView,
  rows: ReadonlyMap<string, InboundMailPartRow>,
  correspondence: FolderChoice | null,
): InboundMailDecision['message'] {
  const part = view.parts.find((candidate) => candidate.kind === 'message')
  if (!part || !clean(part, rows.get(part.id))) return null
  const thread = defaultThread(view)
  if (thread) return { partId: part.id, text: 'full', thread: { action: 'append', mailThreadId: thread.threadId } }
  const name = displaySubject(view.subject)
  if (!name) return null
  const target: InboundMailThreadTarget = { action: 'create', ...textFolder(view, correspondence), name }
  return { partId: part.id, text: 'full', thread: target }
}

export function senderDecision(
  view: InboundMailView,
  rows: readonly InboundMailPartRow[],
  correspondence: FolderChoice | null,
): InboundMailDecision | null {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const parts = attachmentDecisions(view, byId, correspondence)
  const message = messageDecision(view, byId, correspondence)
  if (parts.length === 0 && !message) return null
  return { mailId: view.id, ifMatch: view.ifMatch, parts, message }
}

export function withoutPart(decision: InboundMailDecision, partId: string): InboundMailDecision | null {
  const parts = decision.parts.filter((part) => part.partId !== partId)
  const message = decision.message?.partId === partId ? null : decision.message
  if (parts.length === 0 && !message) return null
  return { ...decision, parts, message }
}

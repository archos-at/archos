/**
 * What a verified writer's direct filing files, and where (ADR-0137, amendment
 * of 2026-11-03; `./sender-file-job.ts` runs it). Exactly what the
 * E-Mail-Eingang offers that member checked, pressed „Ablegen“ without a
 * change, minus anything a person must weigh:
 *
 * - **An attachment** offered checked (`preselected`, `./review-defaults.ts`),
 *   with no risk flag at all (the database refuses a direct filing of a
 *   flagged part) and a name, goes where the review would put it: as the next
 *   Fassung of its earlier document when the sender vouches for it, else into
 *   the folder the agent suggested. With no suggestion (the agent's suggestion
 *   is switched off, out of budget, or its job failed) it goes where the
 *   mail's text goes by default: the folder suggested for the text, else the
 *   first correspondence folder the member may write in, else the project
 *   root. A direct filing never depends on the model having answered; the
 *   risk-flag and name checks hold either way.
 * - **The text**, offered checked and with nothing the content check found,
 *   goes into the pre-selected E-Mail-Verlauf with room; with none it starts a
 *   new one named after the subject, in the folder the agent suggested for
 *   the text, else the first correspondence folder the member may write in,
 *   else the project root (the review's own default, `initialDraft`). A text
 *   without a subject waits for the member to name its Verlauf.
 *
 * Whatever is not filed stays waiting in the E-Mail-Eingang, for any of the
 * project's writers (wait reason `not_filed`).
 * Nothing here acknowledges or releases anything: a direct filing carries no
 * acknowledgement (`inbound_mail_decisions_sender_files_clean`). Pure.
 */

import type { InboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import type { InboundMailDecision, InboundMailPartDecision, InboundMailThreadTarget, InboundMailView } from './inbound-mail-wire'
import { defaultThread, revisionVouched, senderFactsOfView } from './review-defaults'
import { displaySubject } from './subject'
import type { InboundMailSuggestion } from './suggest'

/** A folder a new Verlauf may start in when the agent suggested none: a correspondence folder the sender may write. */
export interface FolderChoice {
  folderId: string | null
}

/** Where a suggestion puts a part: the folder by id when the project has it, else the path filing creates. */
function suggestedTarget(suggestion: InboundMailSuggestion): { folderId: string | null; newFolderPath: string | null } {
  if (suggestion.folderId && !suggestion.newFolder) return { folderId: suggestion.folderId, newFolderPath: null }
  return { folderId: null, newFolderPath: suggestion.folderPath }
}

/** Whether a part may be filed without a click at all: offered checked, and nothing flagged or found on its row. */
function clean(part: { preselected: boolean }, row: InboundMailPartRow | undefined): boolean {
  return part.preselected && !!row && row.riskFlags.length === 0 && row.contentFindings.length === 0
}

/**
 * Where the text goes by default when it starts a Verlauf: the folder the
 * agent suggested for the text, else the correspondence folder the sender may
 * write in, else the project root. Attachments the agent placed nowhere go
 * there too.
 */
function textFolder(
  view: InboundMailView,
  correspondence: FolderChoice | null,
): { folderId: string | null; newFolderPath: string | null } {
  const text = view.parts.find((part) => part.kind === 'message')
  if (text?.suggestion) return suggestedTarget(text.suggestion)
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
    const documentType = part.suggestion?.documentType ?? undefined
    if (part.revisionCandidate && revisionVouched(part, sender)) {
      decisions.push({ partId: part.id, folderId: null, newFolderPath: null, name: part.filename, revisionOf: part.revisionCandidate.documentId, documentType })
    } else {
      const target = part.suggestion ? suggestedTarget(part.suggestion) : textFolder(view, correspondence)
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

/** The decision a verified writer's mail is filed on, as its sender; null when nothing of it can go without them. */
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

/** The same decision without one part: what is filed when the review refused that part (its name taken, its folder gone). */
export function withoutPart(decision: InboundMailDecision, partId: string): InboundMailDecision | null {
  const parts = decision.parts.filter((part) => part.partId !== partId)
  const message = decision.message?.partId === partId ? null : decision.message
  if (parts.length === 0 && !message) return null
  return { ...decision, parts, message }
}

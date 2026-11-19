import type { InboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import type { InboundMailPartDecision, InboundMailPartView, InboundMailView } from './inbound-mail-wire'

function filesUnseen(part: InboundMailPartView, row: InboundMailPartRow | undefined): row is InboundMailPartRow {
  return (
    part.kind === 'attachment' &&
    part.filename !== null &&
    part.preselected &&
    row !== undefined &&
    row.riskFlags.length === 0 &&
    row.contentFindings.length === 0
  )
}

export function followAttachmentDecisions(
  view: InboundMailView,
  rows: readonly InboundMailPartRow[],
): InboundMailPartDecision[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const decisions: InboundMailPartDecision[] = []
  for (const part of view.parts) {
    if (!filesUnseen(part, byId.get(part.id)) || !part.filename) continue
    const documentType = part.suggestion?.documentType ?? undefined
    if (part.revisionCandidate) {
      decisions.push({
        partId: part.id,
        folderId: null,
        newFolderPath: null,
        name: part.filename,
        revisionOf: part.revisionCandidate.documentId,
        documentType,
      })
      continue
    }
    if (part.revisionCandidateHidden) continue
    const suggestion = part.suggestion
    if (!suggestion?.folderId || suggestion.newFolder) continue
    decisions.push({ partId: part.id, folderId: suggestion.folderId, newFolderPath: null, name: part.filename, documentType })
  }
  return decisions
}

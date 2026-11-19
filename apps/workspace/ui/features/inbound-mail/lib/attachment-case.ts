import type { InboundMailPartView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { NotStagedReason, PartRiskFlag } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { isImageInMail, revisionVouchedInThread, senderFactsOfView } from '@/lib/inbound-mail/review-defaults'
import { revisionByDefault } from './plan-index'

export type AttachmentStatus =
  | 'waiting'
  | 'filing'
  | 'filed'
  | 'dismissed'
  | 'expired'
  | 'scan_pending'
  | 'scan_failed'
  | 'scan_infected'
  | 'not_offered'

export type AcknowledgedRisk = Extract<PartRiskFlag, 'macro' | 'type_mismatch' | 'unverified_thread'>

export type AttachmentNote =
  | { kind: 'duplicate'; name: string; folderPath: string | null; documentId: string }
  | { kind: 'revision'; name: string; folderPath: string | null; nextVersion: number; documentId: string; verified: boolean; likely: boolean }
  | { kind: 'revision_hidden' }
  | { kind: 'name_stop'; terms: string[] }
  | { kind: 'risk'; flag: 'macro' | 'type_mismatch' }
  | { kind: 'encrypted' }
  | { kind: 'forwarded_inner' }
  | { kind: 'image_in_mail' }
  | { kind: 'last_failure'; failure: NonNullable<InboundMailPartView['lastFailure']> }

export interface AttachmentCase {
  part: InboundMailPartView
  status: AttachmentStatus
  selectable: boolean
  /** Filed unless the person says otherwise: everything but what the server keeps out for a reason it names. */
  defaultChecked: boolean
  /** Might be the next Fassung of a document, and nothing vouches for it: asked as three choices, never a tick. */
  unsureRevision: boolean
  /** An unsure next Fassung of a plan with a later index of the same number: „Als Fassung …“ is its default answer (`revisionByDefault`). */
  revisionDefault: boolean
  notes: AttachmentNote[]
  risk: AcknowledgedRisk | null
  previewable: boolean
}

const PREVIEW_TYPES = /^(?:image\/(?:png|jpe?g|gif|webp|avif)|application\/pdf)$/i
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024

function statusOf(part: InboundMailPartView): AttachmentStatus {
  if (part.state === 'filed' || part.state === 'filing' || part.state === 'dismissed' || part.state === 'expired') return part.state
  if (!part.offered || part.riskFlags.includes('type_not_accepted')) return 'not_offered'
  if (part.scan === 'pending') return 'scan_pending'
  if (part.scan === 'failed') return 'scan_failed'
  if (part.scan === 'infected') return 'scan_infected'
  return 'waiting'
}

export function attachmentCase(
  part: InboundMailPartView,
  mail: Pick<InboundMailView, 'projectClosed' | 'sender' | 'threadCandidates'> & Partial<Pick<InboundMailView, 'onlySenderReleases' | 'riskLevel'>>,
): AttachmentCase {
  const status = statusOf(part)
  const notes: AttachmentNote[] = []

  if (part.lastFailure) notes.push({ kind: 'last_failure', failure: part.lastFailure })
  if (part.duplicateOf) {
    notes.push({ kind: 'duplicate', name: part.duplicateOf.name, folderPath: part.duplicateOf.folderPath, documentId: part.duplicateOf.documentId })
  }
  const revisionVerified = revisionVouchedInThread(part, senderFactsOfView(mail), mail.threadCandidates)
  const revisionLikely = !revisionVerified && part.revisionCandidate !== null && revisionByDefault(part.filename, part.revisionCandidate.name)
  if (part.revisionCandidate) {
    notes.push({
      kind: 'revision',
      name: part.revisionCandidate.name,
      folderPath: part.revisionCandidate.folderPath,
      nextVersion: part.revisionCandidate.nextVersion,
      documentId: part.revisionCandidate.documentId,
      verified: revisionVerified,
      likely: revisionLikely,
    })
  } else if (part.revisionCandidateHidden) {
    notes.push({ kind: 'revision_hidden' })
  }
  if (part.riskFlags.includes('name_stop')) notes.push({ kind: 'name_stop', terms: part.nameStopTerms })
  const risk: AcknowledgedRisk | null = part.riskFlags.includes('macro')
    ? 'macro'
    : part.riskFlags.includes('type_mismatch')
      ? 'type_mismatch'
      : null
  if (risk === 'macro' || risk === 'type_mismatch') notes.push({ kind: 'risk', flag: risk })
  if (part.riskFlags.includes('encrypted')) notes.push({ kind: 'encrypted' })
  if (part.riskFlags.includes('forwarded_inner')) notes.push({ kind: 'forwarded_inner' })
  if (isImageInMail(part)) notes.push({ kind: 'image_in_mail' })

  const selectable = status === 'waiting' && !mail.projectClosed && !mail.onlySenderReleases
  const unsureRevision = selectable && part.revisionCandidate !== null && !revisionVerified
  return {
    part,
    status,
    selectable,
    defaultChecked: selectable && (part.preselected || (mail.riskLevel !== 'impersonation' && !keptOutForAReason(notes))),
    unsureRevision,
    revisionDefault: unsureRevision && revisionLikely,
    notes,
    risk,
    previewable: part.scan === 'clean' && PREVIEW_TYPES.test(part.contentType) && part.sizeBytes <= PREVIEW_MAX_BYTES && status !== 'filed',
  }
}

const KEPT_OUT: ReadonlySet<AttachmentNote['kind']> = new Set(['duplicate', 'image_in_mail', 'name_stop', 'risk'])

function keptOutForAReason(notes: readonly AttachmentNote[]): boolean {
  return notes.some((note) => KEPT_OUT.has(note.kind))
}

export interface NotStagedSummary {
  listed: Array<{ filename: string; reason: Exclude<NotStagedReason, 'embedded' | 'signature' | 'empty'> }>
  layoutImages: number
}

export function notStagedSummary(notStaged: InboundMailView['notStaged']): NotStagedSummary {
  const listed: NotStagedSummary['listed'] = []
  let layoutImages = 0
  for (const entry of notStaged) {
    if (entry.reason === 'embedded') layoutImages += 1
    else if (entry.reason === 'signature' || entry.reason === 'empty') continue
    else listed.push({ filename: entry.filename, reason: entry.reason })
  }
  return { listed, layoutImages }
}

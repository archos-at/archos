import { isOwnBccCopy, senderPreselectionBlocks, type PreselectionBlock } from '@/lib/mail-thread/mail-threading'
import type {
  InboundMailPartView,
  InboundMailThreadCandidateView,
  InboundMailView,
  IncompleteReason,
} from './inbound-mail-wire'
import type { MalwareScanStatus } from './inbound-mail-vocabulary'
import { impersonationOf, senderNeedsAcknowledgement, senderRiskLevel, type SenderFacts } from './sender-risk'

export const CORRESPONDENCE_FOLDER = /(?:^|\/)\s*(?:korrespondenz|schriftverkehr|correspondence|e-?mails?)\s*$/iu

export type InboundMailPartBase = Omit<InboundMailPartView, 'preselected'>

type DerivedFields = 'riskLevel' | 'impersonation' | 'needsSenderAcknowledgement' | 'incompleteReason'

export type InboundMailViewBase = Omit<InboundMailView, DerivedFields | 'parts'> & { parts: InboundMailPartBase[] }

export function senderFactsOfView(view: Pick<InboundMailView, 'sender'>): SenderFacts | null {
  return view.sender ? { trust: view.sender.trust, reason: view.sender.reason, flags: view.sender.flags } : null
}

export function attachmentSelectable(part: InboundMailPartBase, projectClosed: boolean): boolean {
  return (
    part.kind === 'attachment' &&
    part.state === 'waiting' &&
    part.offered &&
    !part.riskFlags.includes('type_not_accepted') &&
    part.scan === 'clean' &&
    !projectClosed
  )
}

export function isImageInMail(part: Pick<InboundMailPartBase, 'filename' | 'contentType'>): boolean {
  return part.filename === null && part.contentType.toLowerCase().startsWith('image/')
}

interface ThreadVouch {
  blocks: readonly PreselectionBlock[]
}

export function revisionVouched(part: Pick<InboundMailPartBase, 'riskFlags'>, sender: SenderFacts | null): boolean {
  if (sender?.trust !== 'member_verified') return false
  if (senderPreselectionBlocks({ senderTrust: sender.trust, senderFlags: sender.flags }).length > 0) return false
  return !part.riskFlags.includes('unverified_thread')
}

export function revisionVouchedInThread(
  part: Pick<InboundMailPartBase, 'riskFlags'>,
  sender: SenderFacts | null,
  threadCandidates: readonly ThreadVouch[],
): boolean {
  if (revisionVouched(part, sender)) return true
  if (sender?.trust !== 'external_verified' || part.riskFlags.includes('unverified_thread')) return false
  return threadCandidates.some((candidate) => candidate.blocks.length === 0)
}

function attachmentNeedsPerson(part: InboundMailPartBase, sender: SenderFacts | null, threadCandidates: readonly ThreadVouch[]): boolean {
  return (
    part.duplicateOf !== null ||
    part.riskFlags.includes('name_stop') ||
    part.riskFlags.includes('macro') ||
    part.riskFlags.includes('type_mismatch') ||
    isImageInMail(part) ||
    (part.revisionCandidate !== null && !revisionVouchedInThread(part, sender, threadCandidates))
  )
}

function asksForALook(part: InboundMailPartBase): boolean {
  return (
    part.revisionCandidate !== null ||
    part.revisionCandidateHidden ||
    isImageInMail(part) ||
    (['name_stop', 'macro', 'type_mismatch', 'encrypted', 'forwarded_inner'] as const).some((flag) => part.riskFlags.includes(flag))
  )
}

interface MessageContext {
  projectClosed: boolean
  rawScan: MalwareScanStatus
}

interface PartContext extends MessageContext {
  sender: SenderFacts | null
  threadCandidates: readonly ThreadVouch[]
}

export function messageSelectable(part: InboundMailPartBase, mail: MessageContext): boolean {
  return (
    part.kind === 'message' &&
    part.state === 'waiting' &&
    !part.riskFlags.includes('unreadable') &&
    mail.rawScan === 'clean' &&
    !mail.projectClosed
  )
}

export function partPreselected(part: InboundMailPartBase, mail: PartContext): boolean {
  if (!mail.sender || impersonationOf(mail.sender) !== null) return false
  if (part.kind === 'message') return messageSelectable(part, mail) && !mail.sender.flags.includes('already_filed')
  return attachmentSelectable(part, mail.projectClosed) && !attachmentNeedsPerson(part, mail.sender, mail.threadCandidates)
}

export function defaultThread(view: Pick<InboundMailView, 'threadCandidates'>): InboundMailThreadCandidateView | null {
  return view.threadCandidates.find((candidate) => candidate.preselected && !candidate.full) ?? null
}

export function incompleteReason(view: Omit<InboundMailView, DerivedFields>): IncompleteReason | null {
  if (view.status !== 'waiting') return 'not_waiting'
  if (view.projectClosed) return 'project_closed'
  const sender = senderFactsOfView(view)
  if (!sender || senderNeedsAcknowledgement(sender) || view.senderClass === 'unverified_writer') return 'sender'

  const attachments = view.parts.filter((part) => part.kind === 'attachment')
  const waiting = attachments.filter((part) => part.state === 'waiting')
  const offered = waiting.filter((part) => part.offered && !part.riskFlags.includes('type_not_accepted'))
  if (offered.some((part) => part.scan === 'pending' || part.scan === 'failed')) return 'scanning'
  if (offered.some((part) => attachmentSelectable(part, view.projectClosed) && !part.preselected && asksForALook(part))) {
    return 'needs_person'
  }

  const message = view.parts.find((part) => part.kind === 'message')
  if (message?.state === 'waiting') {
    const ownBcc = isOwnBccCopy({ senderTrust: sender.trust, senderFlags: sender.flags })
    if (!defaultThread(view) && !(ownBcc && waiting.length === 0)) return 'no_thread'
  }
  if (attachments.some((part) => part.preselected && part.revisionCandidate === null && part.suggestion === null)) return 'folder_missing'
  return null
}

export function withReviewDefaults(base: InboundMailViewBase): InboundMailView {
  const sender = senderFactsOfView(base)
  const parts = base.parts.map((part) => ({
    ...part,
    preselected:
      !base.onlySenderReleases &&
      partPreselected(part, { projectClosed: base.projectClosed, rawScan: base.rawScan, sender, threadCandidates: base.threadCandidates }),
  }))
  const view = { ...base, parts }
  return {
    ...view,
    riskLevel: senderRiskLevel(sender),
    impersonation: sender ? impersonationOf(sender) : null,
    needsSenderAcknowledgement: sender !== null && (senderNeedsAcknowledgement(sender) || base.senderClass === 'unverified_writer'),
    incompleteReason: incompleteReason(view),
  }
}

import { z } from 'zod'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { DOCUMENT_TYPE_TAGS, type DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import type {
  FilingConventionInput,
  FilingFolderInput,
  MailFilingInput,
  MailPlacement,
} from '@/lib/filing/types'
import { MAX_JUDGED_DOCUMENTS } from '@/lib/filing/types'
import { folderPathKey } from '@/lib/projects/folders'
import type { InboundMailDecision } from './inbound-mail-wire'
import { impersonationOf } from './sender-risk'

export const inboundMailSuggestionSchema = z
  .object({
    folderId: z.string().uuid().nullable(),
    folderPath: z.string().min(1).max(1000),
    newFolder: z.boolean(),
    documentType: z.enum(DOCUMENT_TYPE_TAGS).nullable(),
    reason: z.string().min(1).max(300),
  })
  .strict()
export type InboundMailSuggestion = z.infer<typeof inboundMailSuggestionSchema>

export function readSuggestion(stored: unknown): InboundMailSuggestion | null {
  if (stored === null || stored === undefined) return null
  const parsed = inboundMailSuggestionSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}

export type SuggestionSkipReason =
  | 'not_waiting'
  | 'impersonation'
  | 'automatic'
  | 'project_closed'
  | 'switched_off'
  | 'budget'
  | 'nothing_to_place'

export function suggestionSkipReason(
  mail: Pick<InboundMailRow, 'status' | 'senderTrust' | 'senderReason' | 'senderFlags' | 'automatic'>,
): SuggestionSkipReason | null {
  if (mail.status !== 'waiting' || !mail.senderTrust || !mail.senderReason) return 'not_waiting'
  if (impersonationOf({ trust: mail.senderTrust, reason: mail.senderReason, flags: mail.senderFlags })) return 'impersonation'
  if (mail.automatic) return 'automatic'
  return null
}

type PartFacts = Pick<
  InboundMailPartRow,
  'id' | 'kind' | 'position' | 'state' | 'filename' | 'storageKey' | 'scanStatus' | 'riskFlags' | 'nameStopTerms'
>

export function attachmentsToPlace<T extends PartFacts>(parts: readonly T[]): Array<T & { filename: string }> {
  return parts
    .filter(
      (part): part is T & { filename: string } =>
        part.kind === 'attachment' &&
        part.state === 'waiting' &&
        part.storageKey !== null &&
        part.filename !== null &&
        part.filename.trim().length > 0 &&
        part.scanStatus !== 'infected' &&
        part.nameStopTerms.length === 0 &&
        !part.riskFlags.includes('name_stop') &&
        !part.riskFlags.includes('type_not_accepted'),
    )
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_JUDGED_DOCUMENTS)
}

export function textToPlace<T extends PartFacts>(
  mail: Pick<InboundMailRow, 'threadMatch'>,
  parts: readonly T[],
): T | null {
  if (mail.threadMatch.length > 0) return null
  return parts.find((part) => part.kind === 'message' && part.state === 'waiting') ?? null
}

export function hasSomethingToPlace(mail: Pick<InboundMailRow, 'threadMatch'>, parts: readonly PartFacts[]): boolean {
  return attachmentsToPlace(parts).length > 0 || textToPlace(mail, parts) !== null
}

export interface SuggestionContext {
  mask: (written: string) => string
  folders: FilingFolderInput[]
  conventions: FilingConventionInput[]
  locale: string
}

export function mailFilingInput(
  mail: Pick<InboundMailRow, 'id' | 'projectId' | 'threadMatch' | 'subject' | 'senderAddress' | 'signerDomain' | 'senderClass'>,
  parts: readonly PartFacts[],
  context: SuggestionContext,
): MailFilingInput | null {
  if (!hasSomethingToPlace(mail, parts)) return null
  const attachments = attachmentsToPlace(parts).map((part) => ({ id: part.id, file: context.mask(part.filename) }))
  const text = textToPlace(mail, parts)
  return {
    locale: context.locale,
    folders: context.folders,
    conventions: context.conventions,
    attachments,
    mail: { subject: mail.subject ? context.mask(mail.subject) : null, senderDomain: senderDomainOf(mail), textId: text?.id ?? null },
    trace: { mailId: mail.id, projectId: mail.projectId, senderClass: mail.senderClass },
  }
}

export function senderDomainOf(mail: Pick<InboundMailRow, 'senderAddress' | 'signerDomain'>): string | null {
  const at = mail.senderAddress?.lastIndexOf('@') ?? -1
  const domain = at >= 0 ? mail.senderAddress?.slice(at + 1) : mail.signerDomain
  return domain?.trim().toLowerCase() || null
}

export function suggestionsFrom(
  placements: readonly MailPlacement[],
  folders: ReadonlyArray<{ id: string; path: string }>,
): Map<string, InboundMailSuggestion> {
  const byKey = new Map(folders.map((folder) => [folderPathKey(folder.path), folder]))
  const stored = new Map<string, InboundMailSuggestion>()
  for (const placement of placements) {
    const folder = placement.newFolder ? undefined : byKey.get(folderPathKey(placement.folder))
    if (!placement.newFolder && !folder) continue
    stored.set(placement.partId, {
      folderId: folder?.id ?? null,
      folderPath: folder?.path ?? placement.folder,
      newFolder: placement.newFolder !== null,
      documentType: placement.documentType,
      reason: placement.reason,
    })
  }
  return stored
}

export type DecidedPlacement =
  | { into: 'folder'; folderPath: string; documentType: DocumentTypeTag | string | null }
  | { into: 'thread' }

export function decidedPlacements(
  decision: Pick<InboundMailDecision, 'parts' | 'message'> | null,
  folderPathOf: (folderId: string) => string | null,
): Map<string, DecidedPlacement> {
  const placed = new Map<string, DecidedPlacement>()
  if (!decision) return placed
  const pathOf = (folderId: string | null, newFolderPath: string | null): string =>
    newFolderPath ?? (folderId ? (folderPathOf(folderId) ?? '') : '')
  for (const part of decision.parts) {
    placed.set(part.partId, { into: 'folder', folderPath: pathOf(part.folderId, part.newFolderPath), documentType: part.documentType ?? null })
  }
  const message = decision.message
  if (message) {
    placed.set(
      message.partId,
      message.thread.action === 'create'
        ? { into: 'folder', folderPath: pathOf(message.thread.folderId, message.thread.newFolderPath), documentType: 'correspondence' }
        : { into: 'thread' },
    )
  }
  return placed
}

export type SuggestionOutcome =
  | { decision: 'accepted' | 'dismissed'; folder: 'same' | 'other'; type: 'same' | 'other' | 'none' }
  | { decision: 'not_judged'; folder: 'not_filed' | 'thread'; type: 'none' }

export type JudgedOutcome = Extract<SuggestionOutcome, { decision: 'accepted' | 'dismissed' }>

export const isJudged = (outcome: SuggestionOutcome): outcome is JudgedOutcome => outcome.decision !== 'not_judged'

export function suggestionOutcome(suggestion: InboundMailSuggestion, placed: DecidedPlacement | null): SuggestionOutcome {
  if (!placed) return { decision: 'not_judged', folder: 'not_filed', type: 'none' }
  if (placed.into === 'thread') return { decision: 'not_judged', folder: 'thread', type: 'none' }
  const folder = folderPathKey(placed.folderPath) === folderPathKey(suggestion.folderPath) ? 'same' : 'other'
  const type = !suggestion.documentType ? 'none' : placed.documentType === suggestion.documentType ? 'same' : 'other'
  return { decision: folder === 'same' && type !== 'other' ? 'accepted' : 'dismissed', folder, type }
}

export type SuggestionFollowed = 'all' | 'partly' | 'none' | 'not_judged' | 'no_suggestion'

export function suggestionFollowed(outcomes: readonly SuggestionOutcome[]): SuggestionFollowed {
  if (outcomes.length === 0) return 'no_suggestion'
  const judged = outcomes.filter(isJudged)
  if (judged.length === 0) return 'not_judged'
  const accepted = judged.filter((outcome) => outcome.decision === 'accepted').length
  if (accepted === judged.length) return 'all'
  return accepted === 0 ? 'none' : 'partly'
}

export interface DecidedSuggestion {
  partId: string
  traceId: string | null
  outcome: SuggestionOutcome
}

export function decidedSuggestions(
  parts: ReadonlyArray<Pick<InboundMailPartRow, 'id' | 'state' | 'suggestion' | 'suggestionTraceId'>>,
  decision: Pick<InboundMailDecision, 'parts' | 'message'> | null,
  folderPathOf: (folderId: string) => string | null,
): DecidedSuggestion[] {
  const placed = decidedPlacements(decision, folderPathOf)
  return parts.flatMap((part) => {
    const suggestion = part.state === 'waiting' ? readSuggestion(part.suggestion) : null
    if (!suggestion) return []
    return [{ partId: part.id, traceId: part.suggestionTraceId, outcome: suggestionOutcome(suggestion, placed.get(part.id) ?? null) }]
  })
}

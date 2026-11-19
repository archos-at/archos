import type { DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import type { InboundMailPartView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { attachmentCase, type AttachmentCase } from './attachment-case'
import {
  appendCandidate,
  asksForDecision,
  messageSelectable,
  targetForPath,
  type AttachmentDraft,
  type DraftCopy,
  type FolderOption,
  type FolderTarget,
  type MailDraft,
} from './draft'
import { readSuggestion } from './suggestion'

export const FILING_STEPS = ['sender', 'text', 'attachments', 'overview'] as const
export type FilingStep = (typeof FILING_STEPS)[number]

export type MissingSuggestion = 'pending' | 'skipped' | 'none'

export type OpenReason = 'no_folder' | 'pending' | 'revision_unsure' | 'not_preselected' | 'name_stop' | 'risk'

export function attachmentOpenReason(entry: AttachmentCase, draft: AttachmentDraft, missing: MissingSuggestion): OpenReason | null {
  if (!entry.selectable) return null
  if (entry.unsureRevision) return 'revision_unsure'
  if (!draft.checked) {
    if (!asksForDecision(entry)) return null
    if (entry.part.riskFlags.includes('name_stop')) return 'name_stop'
    return entry.risk ? 'risk' : 'not_preselected'
  }
  if (entry.part.riskFlags.includes('name_stop') && !draft.releaseName) return 'name_stop'
  if (entry.risk && !draft.acknowledgeRisk) return 'risk'
  if (draft.folder === null && draft.revisionOf === null) return missing === 'pending' ? 'pending' : 'no_folder'
  return null
}

export function keptWithoutFolder(view: InboundMailView, draft: MailDraft): number {
  return waitingAttachments(view).filter((entry) => {
    const row = draft.attachments.find((candidate) => candidate.partId === entry.part.id)
    return !!row && entry.selectable && row.checked && row.folder === null && row.revisionOf === null
  }).length
}

function waitingAttachments(view: InboundMailView): AttachmentCase[] {
  return view.parts.filter((part) => part.kind === 'attachment' && part.state === 'waiting').map((part) => attachmentCase(part, view))
}

export function openAttachmentIds(view: InboundMailView, draft: MailDraft, missing: MissingSuggestion): string[] {
  return waitingAttachments(view).flatMap((entry) => {
    const row = draft.attachments.find((candidate) => candidate.partId === entry.part.id)
    return row && attachmentOpenReason(entry, row, missing) !== null ? [entry.part.id] : []
  })
}

export function textNeedsDecision(view: InboundMailView, draft: MailDraft): boolean {
  const part = view.parts.find((candidate) => candidate.kind === 'message')
  const message = draft.message
  if (!part || part.state !== 'waiting' || !message || !messageSelectable(view)) return false
  if (part.contentFindings.length > 0) return true
  if (!message.checked) return !(view.sender?.flags.includes('already_filed') ?? false)
  // A new E-Mail-Verlauf with no existing one to choose instead is the proposal, not a question.
  if (message.target.kind === 'create') return view.threadCandidates.some((candidate) => !candidate.full)
  const chosen = appendCandidate(view, draft)
  return chosen === null || chosen.blocks.length > 0
}

export function senderNeedsDecision(view: Pick<InboundMailView, 'needsSenderAcknowledgement' | 'onlySenderReleases'>): boolean {
  return view.needsSenderAcknowledgement && !view.onlySenderReleases
}

export interface StepNeeds {
  missing: MissingSuggestion
  also?: readonly FilingStep[]
}

export function filingSteps(view: InboundMailView, draft: MailDraft, { missing, also = [] }: StepNeeds): FilingStep[] {
  const needed = new Set<FilingStep>(['overview', ...also])
  if (senderNeedsDecision(view)) needed.add('sender')
  if (textNeedsDecision(view, draft)) needed.add('text')
  if (openAttachmentIds(view, draft, missing).length > 0) needed.add('attachments')
  return FILING_STEPS.filter((step) => needed.has(step))
}

export type LeftReason = 'unchecked' | 'name_stop' | 'risk' | 'duplicate' | 'image' | 'scan_pending' | 'scan_failed' | 'infected' | 'not_offered' | 'closed'

/** One part of the mail and what pressing „Ablegen“ does with it: the sentence of „Übersicht“ and the pane's phrase. */
export type PlanLine =
  | { kind: 'text_append'; partId: string; thread: string; masked: boolean }
  | { kind: 'text_create'; partId: string; thread: string; folder: string; masked: boolean }
  | { kind: 'text_left'; partId: string; includable: boolean }
  | { kind: 'file'; partId: string; name: string; rename: string | null; folder: string; newFolder: boolean; documentType: DocumentTypeTag | null }
  | { kind: 'revision'; partId: string; name: string; version: number; of: string }
  | { kind: 'no_folder'; partId: string; name: string }
  | { kind: 'left'; partId: string; name: string; why: LeftReason; includable: boolean; terms: readonly string[]; risk: AttachmentCase['risk'] }

function leftReason(entry: AttachmentCase): LeftReason {
  switch (entry.status) {
    case 'scan_pending':
    case 'scan_failed':
    case 'not_offered':
      return entry.status
    case 'scan_infected':
      return 'infected'
    default:
      if (!entry.selectable) return 'closed'
      if (entry.notes.some((note) => note.kind === 'duplicate')) return 'duplicate'
      if (entry.notes.some((note) => note.kind === 'image_in_mail')) return 'image'
      if (entry.part.riskFlags.includes('name_stop')) return 'name_stop'
      return entry.risk ? 'risk' : 'unchecked'
  }
}

const INCLUDABLE: ReadonlySet<LeftReason> = new Set(['unchecked', 'name_stop', 'risk'])

function attachmentLine(entry: AttachmentCase, row: AttachmentDraft | undefined, copy: DraftCopy): PlanLine {
  const { part } = entry
  const name = part.filename ?? copy.unnamedAttachment(part.position)
  if (!row || !entry.selectable || !row.checked) {
    const why = leftReason(entry)
    return { kind: 'left', partId: part.id, name, why, includable: INCLUDABLE.has(why), terms: part.nameStopTerms, risk: entry.risk }
  }
  const revision = part.revisionCandidate
  if (row.revisionOf !== null && revision?.documentId === row.revisionOf) {
    return { kind: 'revision', partId: part.id, name, version: revision.nextVersion, of: revision.name }
  }
  if (row.folder === null) return { kind: 'no_folder', partId: part.id, name }
  const renamed = row.name.trim()
  return {
    kind: 'file',
    partId: part.id,
    name,
    rename: renamed !== '' && renamed !== name ? renamed : null,
    folder: row.folder.path,
    newFolder: row.folder.kind === 'new',
    documentType: row.documentType,
  }
}

function textLine(view: InboundMailView, draft: MailDraft, part: InboundMailPartView): PlanLine {
  const message = draft.message
  if (!message?.checked || !messageSelectable(view)) return { kind: 'text_left', partId: part.id, includable: !!message && messageSelectable(view) }
  const masked = message.findingChoice === 'masked' && part.contentFindings.length > 0
  if (message.target.kind === 'create') {
    return { kind: 'text_create', partId: part.id, thread: message.target.name.trim(), folder: message.target.folder.path, masked }
  }
  const candidate = appendCandidate(view, draft)
  return candidate ? { kind: 'text_append', partId: part.id, thread: candidate.name, masked } : { kind: 'text_left', partId: part.id, includable: true }
}

export function planLines(view: InboundMailView, draft: MailDraft, copy: DraftCopy): PlanLine[] {
  const lines: PlanLine[] = []
  const message = view.parts.find((part) => part.kind === 'message' && part.state === 'waiting')
  if (message) lines.push(textLine(view, draft, message))
  for (const entry of waitingAttachments(view)) {
    lines.push(attachmentLine(entry, draft.attachments.find((row) => row.partId === entry.part.id), copy))
  }
  return lines
}

export const leavesParts = (lines: readonly PlanLine[]): boolean => lines.some((line) => line.kind === 'text_left' || line.kind === 'left')

export const filesAnything = (lines: readonly PlanLine[]): boolean => lines.some((line) => line.kind !== 'text_left' && line.kind !== 'left')

export function folderlessIds(view: InboundMailView, draft: MailDraft, missing: MissingSuggestion): string[] {
  return waitingAttachments(view).flatMap((entry) => {
    const row = draft.attachments.find((candidate) => candidate.partId === entry.part.id)
    if (!row || row.folder !== null || row.revisionOf !== null) return []
    return attachmentOpenReason(entry, row, missing) !== null ? [entry.part.id] : []
  })
}

export interface QuickPick {
  target: FolderTarget
  why: 'suggestion' | 'sender' | 'sibling' | 'revision'
  of: string | null
}

const QUICK_PICKS_MAX = 4

export interface QuickPickSources {
  extra?: readonly QuickPick[]
}

export function quickPicks(
  view: InboundMailView,
  draft: MailDraft,
  ids: readonly string[],
  folders: readonly FolderOption[],
  copy: DraftCopy,
  { extra = [] }: QuickPickSources = {},
): QuickPick[] {
  const picks: QuickPick[] = []
  const add = (pick: QuickPick): void => {
    if (!picks.some((known) => known.target.path === pick.target.path)) picks.push(pick)
  }
  for (const id of ids) {
    const suggested = readSuggestion(view.parts.find((candidate) => candidate.id === id)?.suggestion)
    const part = view.parts.find((candidate) => candidate.id === id)
    if (suggested?.folder != null && part?.suggestion?.source !== 'sender_memory')
      add({ target: targetForPath(suggested.folder, folders, suggested.folderId), why: 'suggestion', of: null })
  }
  for (const pick of extra) add(pick)
  for (const row of draft.attachments) {
    if (ids.includes(row.partId) || !row.checked || row.folder === null) continue
    const part = view.parts.find((candidate) => candidate.id === row.partId)
    add({ target: row.folder, why: 'sibling', of: part?.filename ?? copy.unnamedAttachment(part?.position ?? 0) })
  }
  for (const entry of waitingAttachments(view)) {
    const revision = entry.part.revisionCandidate
    if (revision) add({ target: targetForPath(revision.folderPath ?? '', folders), why: 'revision', of: revision.name })
  }
  return picks.slice(0, QUICK_PICKS_MAX)
}

/** One folder for every attachment of `ids` that is ticked; none ticked, it ticks and files them all there. */
export function fileAllInto(draft: MailDraft, ids: readonly string[], target: FolderTarget): { draft: MailDraft; moved: number } {
  const ticked = ids.filter((id) => draft.attachments.some((row) => row.partId === id && row.checked))
  const chosen = ticked.length > 0 ? ticked : ids
  const attachments = draft.attachments.map((row) =>
    chosen.includes(row.partId)
      ? { ...row, checked: true, folder: target, revisionOf: null, suggested: { ...row.suggested, folder: false } }
      : row
  )
  return { draft: { ...draft, attachments }, moved: chosen.length }
}

export function fileable(view: InboundMailView): boolean {
  if (view.onlySenderReleases) return false
  return messageSelectable(view) || waitingAttachments(view).some((entry) => entry.selectable)
}

import type { DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import type {
  InboundMailDecision,
  InboundMailPartDecision,
  InboundMailThreadCandidateView,
  InboundMailView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { CORRESPONDENCE_FOLDER, defaultThread, messageSelectable as partMessageSelectable } from '@/lib/inbound-mail/review-defaults'
import { displaySubject } from '@/lib/inbound-mail/subject'
import { dismissErases } from './inbox-triage'
import { attachmentCase, type AttachmentCase } from './attachment-case'
import { senderDisplayName } from './sender'
import { readSuggestion, type PartSuggestion } from './suggestion'

export interface FolderOption {
  id: string
  parentId: string | null
  name: string
  path: string
  writable: boolean
}

export type FolderTarget = { kind: 'existing'; folderId: string | null; path: string } | { kind: 'new'; path: string }

export const ROOT_TARGET: FolderTarget = { kind: 'existing', folderId: null, path: '' }

export interface AttachmentDraft {
  partId: string
  checked: boolean
  name: string
  folder: FolderTarget | null
  documentType: DocumentTypeTag | null
  revisionOf: string | null
  releaseName: boolean
  acknowledgeRisk: boolean
  suggested: { folder: boolean; name: boolean; documentType: boolean }
}

export type MessageTarget =
  | { kind: 'append'; threadId: string }
  | { kind: 'create'; name: string; folder: FolderTarget; folderSuggested: boolean; releaseName: boolean }

export type ContentFindingChoice = 'masked' | 'full'

export interface MessageDraft {
  partId: string
  checked: boolean
  target: MessageTarget
  findingChoice: ContentFindingChoice | null
  acknowledgeThread: boolean
}

export interface MailDraft {
  mailId: string
  ifMatch: string
  attachments: AttachmentDraft[]
  message: MessageDraft | null
  acknowledgeSender: boolean
}

export interface DraftCopy {
  unnamedAttachment: (position: number) => string
  untitledThread: string
}


export function targetForPath(path: string, folders: readonly FolderOption[], folderId: string | null = null): FolderTarget {
  const normalized = path.split('/').map((part) => part.trim()).filter(Boolean).join('/')
  if (normalized === '') return ROOT_TARGET
  const byId = folderId ? folders.find((folder) => folder.id === folderId) : undefined
  const existing = byId ?? folders.find((folder) => folder.path.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)
  return existing ? { kind: 'existing', folderId: existing.id, path: existing.path } : { kind: 'new', path: normalized }
}

function attachmentDraft(entry: AttachmentCase, folders: readonly FolderOption[], copy: DraftCopy): AttachmentDraft {
  const { part } = entry
  const suggestion: PartSuggestion | null = readSuggestion(part.suggestion)
  const revision = part.revisionCandidate
  const revisionChosen = revision !== null && entry.defaultChecked
  const folder = revisionChosen
    ? targetForPath(revision.folderPath ?? '', folders)
    : suggestion?.folder !== undefined && suggestion?.folder !== null
      ? targetForPath(suggestion.folder, folders, suggestion.folderId)
      : null
  return {
    partId: part.id,
    checked: entry.defaultChecked,
    name: suggestion?.name ?? part.filename ?? copy.unnamedAttachment(part.position),
    folder,
    documentType: suggestion?.documentType ?? null,
    revisionOf: revisionChosen ? revision.documentId : null,
    releaseName: false,
    acknowledgeRisk: false,
    suggested: {
      folder: folder !== null && !revisionChosen,
      name: suggestion?.name != null,
      documentType: suggestion?.documentType != null,
    },
  }
}

export function defaultThreadFolder(folders: readonly FolderOption[]): FolderTarget {
  const folder = folders.find((option) => option.writable && CORRESPONDENCE_FOLDER.test(option.path))
  return folder ? { kind: 'existing', folderId: folder.id, path: folder.path } : ROOT_TARGET
}

export function newThreadTarget(view: Pick<InboundMailView, 'subject' | 'parts'>, folders: readonly FolderOption[], copy: DraftCopy): MessageTarget {
  const suggested = readSuggestion(view.parts.find((part) => part.kind === 'message')?.suggestion)
  const fromAgent = suggested?.folder != null
  const folder = fromAgent ? targetForPath(suggested.folder ?? '', folders, suggested.folderId) : defaultThreadFolder(folders)
  return { kind: 'create', name: displaySubject(view.subject) ?? copy.untitledThread, folder, folderSuggested: fromAgent, releaseName: false }
}

export function messageSelectable(view: InboundMailView): boolean {
  const part = view.parts.find((candidate) => candidate.kind === 'message')
  return !!part && partMessageSelectable(part, view)
}

export function initialDraft(view: InboundMailView, folders: readonly FolderOption[], copy: DraftCopy): MailDraft {
  const attachments = view.parts
    .filter((part) => part.kind === 'attachment')
    .map((part) => attachmentDraft(attachmentCase(part, view), folders, copy))
  const messagePart = view.parts.find((part) => part.kind === 'message')
  let message: MessageDraft | null = null
  if (messagePart) {
    const thread = defaultThread(view)
    message = {
      partId: messagePart.id,
      checked: messageSelectable(view) && messagePart.preselected,
      target: thread ? { kind: 'append', threadId: thread.threadId } : newThreadTarget(view, folders, copy),
      findingChoice: messagePart.contentFindings.length > 0 ? 'masked' : null,
      acknowledgeThread: false,
    }
  }
  return { mailId: view.id, ifMatch: view.ifMatch, attachments, message, acknowledgeSender: false }
}

function sameTarget(a: FolderTarget | null, b: FolderTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.path === b.path && (a.kind === 'new' || b.kind === 'new' || a.folderId === b.folderId)
}

export function updateAttachment(draft: MailDraft, partId: string, change: Partial<Omit<AttachmentDraft, 'partId' | 'suggested'>>): MailDraft {
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) =>
      attachment.partId !== partId
        ? attachment
        : {
            ...attachment,
            ...change,
            suggested: {
              folder: attachment.suggested.folder && (change.folder === undefined || sameTarget(change.folder, attachment.folder)),
              name: attachment.suggested.name && (change.name === undefined || change.name === attachment.name),
              documentType:
                attachment.suggested.documentType && (change.documentType === undefined || change.documentType === attachment.documentType),
            },
          }
    ),
  }
}

export function selectableAttachmentIds(view: InboundMailView): string[] {
  return view.parts
    .filter((part) => part.kind === 'attachment')
    .map((part) => attachmentCase(part, view))
    .filter((entry) => entry.selectable)
    .map((entry) => entry.part.id)
}

export function checkAllAttachments(draft: MailDraft, view: InboundMailView, checked: boolean): MailDraft {
  const selectable = new Set(selectableAttachmentIds(view))
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) => (selectable.has(attachment.partId) ? { ...attachment, checked } : attachment)),
  }
}

export function checkedAttachmentIds(draft: MailDraft, view: InboundMailView): string[] {
  const selectable = new Set(selectableAttachmentIds(view))
  return draft.attachments.filter((attachment) => attachment.checked && selectable.has(attachment.partId)).map((attachment) => attachment.partId)
}

export function fileCheckedInto(draft: MailDraft, view: InboundMailView, folder: FolderTarget): { draft: MailDraft; moved: number; revisions: number } {
  let next = draft
  let moved = 0
  let revisions = 0
  for (const partId of checkedAttachmentIds(draft, view)) {
    const attachment = draft.attachments.find((candidate) => candidate.partId === partId)
    if (attachment?.revisionOf) {
      revisions += 1
      continue
    }
    next = updateAttachment(next, partId, { folder })
    moved += 1
  }
  return { draft: next, moved, revisions }
}

function sameAttachment(a: AttachmentDraft, b: AttachmentDraft): boolean {
  return (
    a.checked === b.checked &&
    a.name === b.name &&
    sameTarget(a.folder, b.folder) &&
    a.documentType === b.documentType &&
    a.revisionOf === b.revisionOf &&
    a.releaseName === b.releaseName &&
    a.acknowledgeRisk === b.acknowledgeRisk
  )
}

function sameMessage(a: MessageDraft | null, b: MessageDraft | null): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function rebaseDraft(edited: MailDraft, base: MailDraft, fresh: MailDraft): MailDraft {
  if (edited.mailId !== fresh.mailId || base.mailId !== fresh.mailId) return fresh
  const ids = (draft: MailDraft): string =>
    [...draft.attachments.map((attachment) => attachment.partId), draft.message?.partId ?? ''].sort().join(',')
  if (ids(edited) !== ids(fresh) || ids(base) !== ids(fresh)) return fresh
  const attachments = fresh.attachments.map((next) => {
    const mine = edited.attachments.find((candidate) => candidate.partId === next.partId)
    const before = base.attachments.find((candidate) => candidate.partId === next.partId)
    return mine && before && !sameAttachment(mine, before) ? mine : next
  })
  const message = sameMessage(edited.message, base.message) ? fresh.message : edited.message
  return { ...fresh, attachments, message, acknowledgeSender: edited.acknowledgeSender }
}

export function updateMessage(draft: MailDraft, change: Partial<Omit<MessageDraft, 'partId'>>): MailDraft {
  return draft.message ? { ...draft, message: { ...draft.message, ...change } } : draft
}

export function appendCandidate(view: Pick<InboundMailView, 'threadCandidates'>, draft: MailDraft): InboundMailThreadCandidateView | null {
  const target = draft.message?.target
  return target?.kind === 'append' ? (view.threadCandidates.find((candidate) => candidate.threadId === target.threadId) ?? null) : null
}

export function appendNeedsAcknowledgement(candidate: InboundMailThreadCandidateView): boolean {
  return candidate.blocks.some((block) => block !== 'weak_match')
}

export type DraftBlocker =
  | { kind: 'project_closed' }
  | { kind: 'folder_missing'; count: number }
  | { kind: 'name_stop'; count: number }
  | { kind: 'risk'; count: number }
  | { kind: 'thread_name_missing' }
  | { kind: 'sender' }
  | { kind: 'sender_only' }

export type TextPlan = ({ kind: 'append'; name: string } | { kind: 'create'; name: string; folder: string }) & { masked: boolean }

export interface FilesPlan {
  folders: string[]
  single: { name: string; folder: string | null; revision: { version: number; of: string } | null } | null
}

export interface DraftSummary {
  files: number
  text: boolean
  thread: { name: string; nextVersion: number } | null
  textPlan: TextPlan | null
  filesPlan: FilesPlan
  left: { text: boolean; files: string[] }
  undecided: string[]
  dismissErases: boolean
  needsSenderAcknowledgement: boolean
  ownClaimedMail: boolean
  claimedWriter: string | null
  blockers: DraftBlocker[]
}

export function draftSummary(view: InboundMailView, draft: MailDraft): DraftSummary {
  const cases = new Map(view.parts.map((part) => [part.id, attachmentCase(part, view)]))
  const checked = draft.attachments.filter((attachment) => attachment.checked && cases.get(attachment.partId)?.selectable)
  const text = !!draft.message?.checked && messageSelectable(view)
  const candidate = text ? appendCandidate(view, draft) : null
  const files = checked.length
  const needsSender = files + (text ? 1 : 0) > 0 && view.needsSenderAcknowledgement

  const blockers: DraftBlocker[] = []
  if (view.projectClosed) blockers.push({ kind: 'project_closed' })
  const folderMissing = checked.filter((attachment) => attachment.folder === null && attachment.revisionOf === null).length
  if (folderMissing > 0) blockers.push({ kind: 'folder_missing', count: folderMissing })
  const nameStops = checked.filter((attachment) => cases.get(attachment.partId)?.part.riskFlags.includes('name_stop') && !attachment.releaseName).length
  if (nameStops > 0) blockers.push({ kind: 'name_stop', count: nameStops })
  const risks =
    checked.filter((attachment) => attachmentNeedsAcknowledgement(view, attachment, cases.get(attachment.partId)) && !attachment.acknowledgeRisk)
      .length + (candidate && appendNeedsAcknowledgement(candidate) && !draft.message?.acknowledgeThread ? 1 : 0)
  if (risks > 0) blockers.push({ kind: 'risk', count: risks })
  if (text && draft.message?.target.kind === 'create' && draft.message.target.name.trim() === '') blockers.push({ kind: 'thread_name_missing' })
  if (needsSender && !draft.acknowledgeSender) blockers.push({ kind: 'sender' })
  if (view.onlySenderReleases && files + (text ? 1 : 0) > 0) blockers.push({ kind: 'sender_only' })

  const textTarget = text ? draft.message?.target : undefined
  const masked = draft.message?.findingChoice === 'masked'
  const textPlan: TextPlan | null = !textTarget
    ? null
    : textTarget.kind === 'append'
      ? candidate
        ? { kind: 'append', name: candidate.name, masked }
        : null
      : { kind: 'create', name: textTarget.name.trim(), folder: textTarget.folder.path, masked }
  const unticked = draft.attachments.filter((attachment) => !attachment.checked && cases.get(attachment.partId)?.selectable)
  const first = checked[0]
  const firstCase = first ? cases.get(first.partId) : undefined
  const revision = first?.revisionOf && firstCase?.part.revisionCandidate?.documentId === first.revisionOf ? firstCase.part.revisionCandidate : null

  return {
    files,
    text,
    thread: candidate ? { name: candidate.name, nextVersion: candidate.nextVersion } : null,
    textPlan,
    filesPlan: {
      folders: [...new Set(checked.map((attachment) => attachment.folder?.path).filter((path): path is string => path !== undefined))],
      single:
        files === 1 && first
          ? { name: first.name, folder: first.folder?.path ?? null, revision: revision ? { version: revision.nextVersion, of: revision.name } : null }
          : null,
    },
    left: { text: messageSelectable(view) && !!draft.message && !draft.message.checked, files: unticked.map((attachment) => attachment.name) },
    undecided: unticked.filter((attachment) => asksForDecision(cases.get(attachment.partId))).map((attachment) => attachment.name),
    dismissErases: dismissErases({ senderTrust: view.sender?.trust ?? null, senderFlags: view.sender?.flags ?? [], onlySenderReleases: view.onlySenderReleases }),
    needsSenderAcknowledgement: needsSender,
    ownClaimedMail: view.ownClaimedMail,
    claimedWriter:
      view.senderClass === 'unverified_writer' && !view.ownClaimedMail && !view.onlySenderReleases && view.sender ? senderDisplayName(view.sender) : null,
    blockers,
  }
}

export function asksForDecision(entry: AttachmentCase | undefined): boolean {
  if (!entry || !entry.selectable || entry.defaultChecked) return false
  return !entry.notes.some((note) => note.kind === 'duplicate' || note.kind === 'image_in_mail')
}

export function attachmentNeedsAcknowledgement(
  view: Pick<InboundMailView, 'sender' | 'projectClosed'>,
  attachment: AttachmentDraft,
  entry: AttachmentCase | undefined,
): boolean {
  if (!entry) return false
  if (entry.risk) return true
  const revision = entry.notes.find((note) => note.kind === 'revision')
  return attachment.revisionOf !== null && revision?.kind === 'revision' && !revision.verified
}

function folderFields(target: FolderTarget | null): { folderId: string | null; newFolderPath: string | null } {
  if (!target) return { folderId: null, newFolderPath: null }
  return target.kind === 'existing' ? { folderId: target.folderId, newFolderPath: null } : { folderId: null, newFolderPath: target.path }
}

export function decisionOf(view: InboundMailView, draft: MailDraft, options: { bulk?: boolean } = {}): InboundMailDecision {
  const cases = new Map(view.parts.map((part) => [part.id, attachmentCase(part, view)]))
  const acknowledged: string[] = []
  const parts: InboundMailPartDecision[] = draft.attachments
    .filter((attachment) => attachment.checked && cases.get(attachment.partId)?.selectable)
    .map((attachment) => {
      if (attachment.acknowledgeRisk && attachmentNeedsAcknowledgement(view, attachment, cases.get(attachment.partId))) {
        acknowledged.push(attachment.partId)
      }
      return {
        partId: attachment.partId,
        ...folderFields(attachment.folder),
        name: attachment.name.trim(),
        ...(attachment.documentType ? { documentType: attachment.documentType } : {}),
        ...(attachment.revisionOf ? { revisionOf: attachment.revisionOf } : {}),
        ...(attachment.releaseName ? { screeningRelease: 'name' as const } : {}),
      }
    })

  let message: InboundMailDecision['message'] = null
  const draftMessage = draft.message
  if (draftMessage?.checked && messageSelectable(view)) {
    const target = draftMessage.target
    const thread: NonNullable<InboundMailDecision['message']>['thread'] =
      target.kind === 'append'
        ? { action: 'append', mailThreadId: target.threadId }
        : {
            action: 'create',
            ...folderFields(target.folder),
            name: target.name.trim(),
            ...(target.releaseName ? { screeningRelease: 'name' as const } : {}),
          }
    message = { partId: draftMessage.partId, text: draftMessage.findingChoice === 'masked' ? 'masked' : 'full', thread }
    const candidate = appendCandidate(view, draft)
    if (candidate && appendNeedsAcknowledgement(candidate) && draftMessage.acknowledgeThread) acknowledged.push(draftMessage.partId)
  }

  const decision: InboundMailDecision = { mailId: view.id, ifMatch: draft.ifMatch, parts, message }
  if (options.bulk) return decision
  if (draft.acknowledgeSender && view.needsSenderAcknowledgement && (parts.length > 0 || message)) {
    decision.acknowledgeSender = true
  }
  if (acknowledged.length > 0) decision.acknowledgeRisk = acknowledged
  return decision
}

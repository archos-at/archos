import type {
  InboundMailDecision,
  InboundMailSummaryView,
  InboundMailView,
  IncompleteReason,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { appendCandidate, decisionOf, draftSummary, initialDraft, type DraftCopy, type FolderOption, type MailDraft } from './draft'

export type FileableFacts = Pick<InboundMailSummaryView, 'status' | 'incompleteReason' | 'riskLevel'>

export function fileableReason(mail: FileableFacts): IncompleteReason | null {
  if (mail.status !== 'waiting') return 'not_waiting'
  if (mail.riskLevel === 'impersonation') return 'sender'
  return mail.incompleteReason
}

export function isReady(mail: FileableFacts): boolean {
  return fileableReason(mail) === null
}

export type AsSuggested =
  | { ok: true; decisions: InboundMailDecision[]; plan: BulkPlan }
  | { ok: false; reason: IncompleteReason; count: number }

export function asSuggested(views: readonly InboundMailView[], folders: readonly FolderOption[], copy: DraftCopy): AsSuggested {
  const reasons = new Map<IncompleteReason, number>()
  for (const view of views) {
    const reason = fileableReason(view)
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  const [first] = reasons.entries()
  if (first) return { ok: false, reason: first[0], count: first[1] }
  const entries = views.map((view) => ({ view, draft: initialDraft(view, folders, copy) }))
  return {
    ok: true,
    decisions: entries.map(({ view, draft }) => decisionOf(view, draft, { bulk: true })),
    plan: bulkPlan(entries),
  }
}

export interface BulkDestination {
  kind: 'folder' | 'new_folder' | 'thread' | 'new_thread'
  label: string
  count: number
}

export interface BulkPlan {
  mails: number
  files: number
  texts: number
  destinations: BulkDestination[]
}

export function bulkPlan(entries: ReadonlyArray<{ view: InboundMailView; draft: MailDraft }>): BulkPlan {
  const destinations = new Map<string, BulkDestination>()
  const add = (kind: BulkDestination['kind'], label: string): void => {
    const key = `${kind}:${label}`
    const current = destinations.get(key)
    if (current) current.count += 1
    else destinations.set(key, { kind, label, count: 1 })
  }
  let files = 0
  let texts = 0
  for (const { view, draft } of entries) {
    const summary = draftSummary(view, draft)
    files += summary.files
    if (summary.text) texts += 1
    for (const attachment of draft.attachments) {
      if (!attachment.checked) continue
      if (attachment.revisionOf !== null) {
        const revision = view.parts.find((part) => part.id === attachment.partId)?.revisionCandidate
        add('folder', revision?.folderPath ?? '')
      } else if (attachment.folder) {
        add(attachment.folder.kind === 'new' ? 'new_folder' : 'folder', attachment.folder.path)
      }
    }
    if (summary.text) {
      const candidate = appendCandidate(view, draft)
      const target = draft.message?.target
      if (candidate) add('thread', candidate.name)
      else if (target?.kind === 'create') add('new_thread', target.name)
    }
  }
  const order: Record<BulkDestination['kind'], number> = { thread: 0, new_thread: 1, folder: 2, new_folder: 3 }
  return {
    mails: entries.length,
    files,
    texts,
    destinations: [...destinations.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.count - a.count || a.label.localeCompare(b.label)),
  }
}

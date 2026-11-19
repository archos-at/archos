import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { folderTree, readableByEveryMember } from '@/lib/authz/folder-access-rule'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { unaskedSpendAllowed } from '@/lib/budgets/unasked-spend'
import { hasPassedScreening, SCREENED_ONLY } from '@/lib/documents/document-reader'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import { projectShelf } from '@/lib/documents/shelf'
import { docTypesByFolder, officeConventions } from '@/lib/filing/conventions'
import { judgeMailFiling } from '@/lib/filing/judge'
import { listFiledDocuments, listProjectsFolders, type OfficeFolderRow } from '@/lib/filing/repository'
import { filingSuggestionsEnabled } from '@/lib/filing/trigger'
import { MAX_JUDGED_FOLDERS, type FilingConventionInput, type FilingFolderInput } from '@/lib/filing/types'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type { InboundMailSuggestPayload, JobAttempt } from '@/lib/jobs-queue/types'
import { recordMailSuggestionOutcome } from '@/lib/langfuse/mail-suggestion-trace'
import { folderPathKey } from '@/lib/projects/folders'
import { isProjectClosed } from '@/lib/projects/project-status'
import { findProjectInOrg, listProjectsInOrg } from '@/lib/projects/repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { chatScreeningRules, maskText } from '@/lib/upload-screening/content-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
import { directFilingEnabled } from './direct-filing'
import { findMailForReceive, findMailParts, storePartSuggestions } from './repository'
import {
  hasSomethingToPlace,
  mailFilingInput,
  suggestionsFrom,
  suggestionSkipReason,
  type SuggestionSkipReason,
} from './suggest'

const REASON_LOCALE = 'de'
const CONVENTION_PROJECTS = 20
const MIN_CONVENTION_PROJECTS = 2

const RETRIED_FAILURES: ReadonlySet<string> = new Set(['backend_unreachable', 'llm_request_failed', 'llm_response_malformed'])

export const isTransientFailure = (reason: string): boolean => RETRIED_FAILURES.has(reason) || /^backend_5\d\d$/.test(reason)

export type SuggestOutcome = (
  | { status: 'skipped'; reason: SuggestionSkipReason }
  | { status: 'failed'; reason: string; traceId: string | null }
  | { status: 'suggested'; asked: number; parts: number; traceId: string | null }
) & { senderTrust?: InboundMailRow['senderTrust'] }

const skipped = (reason: SuggestionSkipReason): SuggestOutcome => ({ status: 'skipped', reason })

export class SuggestionRetryError extends Error {
  constructor(readonly reason: string) {
    super(`the filing suggestion failed (${reason}) and is asked again`)
    this.name = 'SuggestionRetryError'
  }
}

export async function runInboundMailSuggest(organizationId: string, payload: InboundMailSuggestPayload, attempt: JobAttempt): Promise<void> {
  const outcome = await suggestForMail(organizationId, payload).catch((error: unknown) => {
    recordSuggestOutcome(organizationId, payload.mailId, { status: 'failed', reason: 'unexpected', traceId: null }, !attempt.last)
    throw error
  })
  const retry = outcome.status === 'failed' && isTransientFailure(outcome.reason) && !attempt.last
  recordSuggestOutcome(organizationId, payload.mailId, outcome, retry)
  if (retry) throw new SuggestionRetryError(outcome.reason)
}

export function recordSuggestOutcome(organizationId: string, mailId: string, outcome: SuggestOutcome, willRetry: boolean): void {
  const detail = outcome.status === 'suggested' ? `${outcome.parts} of ${outcome.asked} part(s)` : outcome.reason
  const line = `[inbound-mail] suggestion for mail ${mailId}: ${outcome.status} (${detail})${willRetry ? ', asked again' : ''}`
  if (outcome.status === 'failed') console.warn(line)
  else console.debug(line)
  const traceId = outcome.status === 'skipped' ? null : outcome.traceId
  captureServer({
    event: 'inbound_mail_suggested',
    distinctId: null,
    organizationId,
    properties: {
      outcome: outcome.status,
      reason: outcome.status === 'suggested' ? null : outcome.reason,
      asked: outcome.status === 'suggested' ? outcome.asked : null,
      parts: outcome.status === 'suggested' ? outcome.parts : null,
      will_retry: willRetry,
      sender_trust: outcome.senderTrust ?? null,
      mail_id: mailId,
      langfuse_trace_id: traceId,
    },
  })
  if (outcome.status === 'skipped' || !traceId) return
  void recordMailSuggestionOutcome({
    traceId,
    mailId,
    status: outcome.status,
    reason: outcome.status === 'failed' ? outcome.reason : null,
    asked: outcome.status === 'suggested' ? outcome.asked : 0,
    stored: outcome.status === 'suggested' ? outcome.parts : 0,
    willRetry,
    at: new Date(),
  })
}

export async function suggestForMail(organizationId: string, payload: InboundMailSuggestPayload): Promise<SuggestOutcome> {
  if (!filingSuggestionsEnabled()) return skipped('switched_off')
  const mail = await findMailForReceive(payload.mailId)
  if (!mail || mail.projectId !== payload.projectId || mail.organizationId !== organizationId) return skipped('not_waiting')
  return { ...(await suggestForHeldMail(organizationId, mail)), senderTrust: mail.senderTrust }
}

async function suggestForHeldMail(organizationId: string, mail: InboundMailRow): Promise<SuggestOutcome> {
  const skip = suggestionSkipReason(mail)
  if (skip) return skipped(skip)
  const project = await findProjectInOrg(mail.projectId, organizationId)
  if (!project || isProjectClosed(project)) return skipped('project_closed')

  const parts = await findMailParts([mail.id])
  if (!hasSomethingToPlace(mail, parts)) return skipped('nothing_to_place')
  if (!(await unaskedSpendAllowed({ organizationId, userId: null }, mail.projectId))) return skipped('budget')

  const folders = await memberReadableFolders(organizationId, mail.projectId)
  const [folderInputs, conventions, mask] = await Promise.all([
    folderInputsOf(organizationId, mail.projectId, folders),
    filedUnseen(mail) ? [] : conventionsFor(organizationId, mail.projectId, folders.map((folder) => folder.path)),
    maskerFor(organizationId, mail.projectId),
  ])
  const input = mailFilingInput(mail, parts, { mask, folders: folderInputs, conventions, locale: REASON_LOCALE })
  if (!input) return skipped('nothing_to_place')
  const judgement = await judgeMailFiling(organizationId, input)
  if (judgement.error) return { status: 'failed', reason: judgement.error, traceId: judgement.traceId }

  const suggestions = suggestionsFrom(judgement.placements, folders)
  const stored = await storePartSuggestions(mail.id, suggestions, judgement.traceId)
  if (stored > 0) publishProjectChanged(organizationId, mail.projectId)
  const asked = input.attachments.length + (input.mail.textId ? 1 : 0)
  return { status: 'suggested', asked, parts: stored, traceId: judgement.traceId }
}

function filedUnseen(mail: Pick<InboundMailRow, 'senderClass'>): boolean {
  return mail.senderClass === 'verified_writer' && directFilingEnabled()
}

async function memberReadableFolders(organizationId: string, projectId: string): Promise<OfficeFolderRow[]> {
  const [rows, tree] = await Promise.all([
    listProjectsFolders(organizationId, [projectId]),
    listProjectFolderTree(organizationId, projectId).then(folderTree),
  ])
  return rows.filter((row) => readableByEveryMember(tree, row.id)).slice(0, MAX_JUDGED_FOLDERS)
}

async function folderInputsOf(
  organizationId: string,
  projectId: string,
  folders: readonly OfficeFolderRow[],
): Promise<FilingFolderInput[]> {
  const paths = new Map(folders.map((folder) => [folder.id, folder.path]))
  const filed = await listFiledDocuments(organizationId, projectShelf(projectId), SCREENED_ONLY)
  const read = await reconcileDocumentStatuses(filed, organizationId, 'read')
  const docTypes = docTypesByFolder(
    read
      .filter((row) => hasPassedScreening(row) && row.folderId !== null && paths.has(row.folderId))
      .map((row) => ({ folderPath: paths.get(row.folderId as string) ?? '', tags: row.tags })),
  )
  return folders.map((folder) => ({
    path: folder.path,
    description: folder.description,
    docTypes: docTypes.get(folderPathKey(folder.path)) ?? [],
  }))
}

async function conventionsFor(
  organizationId: string,
  projectId: string,
  existingPaths: readonly string[],
): Promise<FilingConventionInput[]> {
  const recent = (await listProjectsInOrg(organizationId, { limit: CONVENTION_PROJECTS + 1 }))
    .filter((project) => project.id !== projectId)
    .slice(0, CONVENTION_PROJECTS)
  const rows = await listProjectsFolders(
    organizationId,
    recent.map((project) => project.id),
  )
  const conventions = officeConventions(rows, existingPaths)
  const shared = conventions.filter((convention) => convention.projects === 0 || convention.projects >= MIN_CONVENTION_PROJECTS)
  return shared.length > 0 ? shared : officeConventions([], existingPaths)
}

async function maskerFor(organizationId: string, projectId: string): Promise<(written: string) => string> {
  const rules = chatScreeningRules(await gatePolicy(organizationId, projectId))
  return (written) => maskText(written, rules).text
}

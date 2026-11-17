import 'server-only'
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
import type { InboundMailSuggestPayload } from '@/lib/jobs-queue/types'
import { folderPathKey } from '@/lib/projects/folders'
import { isProjectClosed } from '@/lib/projects/project-status'
import { findProjectInOrg, listProjectsInOrg } from '@/lib/projects/repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { chatScreeningRules, maskText } from '@/lib/upload-screening/content-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
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

export type SuggestOutcome =
  | { status: 'skipped'; reason: SuggestionSkipReason }
  | { status: 'failed'; reason: string }
  | { status: 'suggested'; parts: number; traceId: string | null }

const skipped = (reason: SuggestionSkipReason): SuggestOutcome => ({ status: 'skipped', reason })

export async function runInboundMailSuggest(organizationId: string, payload: InboundMailSuggestPayload): Promise<void> {
  const outcome = await suggestForMail(organizationId, payload)
  const detail = outcome.status === 'suggested' ? `${outcome.parts} part(s)` : outcome.reason
  console.debug(`[inbound-mail] suggestion for mail ${payload.mailId}: ${outcome.status} (${detail})`)
}

export async function suggestForMail(organizationId: string, payload: InboundMailSuggestPayload): Promise<SuggestOutcome> {
  if (!filingSuggestionsEnabled()) return skipped('switched_off')
  const mail = await findMailForReceive(payload.mailId)
  if (!mail || mail.projectId !== payload.projectId || mail.organizationId !== organizationId) return skipped('not_waiting')
  const skip = suggestionSkipReason(mail)
  if (skip) return skipped(skip)
  const project = await findProjectInOrg(mail.projectId, organizationId)
  if (!project || isProjectClosed(project)) return skipped('project_closed')

  const parts = await findMailParts([mail.id])
  if (!hasSomethingToPlace(mail, parts)) return skipped('nothing_to_place')
  if (!(await unaskedSpendAllowed({ organizationId, userId: null }, mail.projectId))) return skipped('budget')

  const folders = await memberReadableFolders(organizationId, mail.projectId)
  const [folderInputs, conventions, maskedSubject] = await Promise.all([
    folderInputsOf(organizationId, mail.projectId, folders),
    conventionsFor(organizationId, mail.projectId, folders.map((folder) => folder.path)),
    maskedSubjectOf(organizationId, mail.projectId, mail.subject),
  ])
  const input = mailFilingInput(mail, parts, { maskedSubject, folders: folderInputs, conventions, locale: REASON_LOCALE })
  if (!input) return skipped('nothing_to_place')
  const judgement = await judgeMailFiling(organizationId, input)
  if (judgement.error) return { status: 'failed', reason: judgement.error }

  const suggestions = suggestionsFrom(judgement.placements, folders)
  const stored = await storePartSuggestions(mail.id, suggestions, judgement.traceId)
  if (stored > 0) publishProjectChanged(organizationId, mail.projectId)
  return { status: 'suggested', parts: stored, traceId: judgement.traceId }
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

async function maskedSubjectOf(organizationId: string, projectId: string, subject: string | null): Promise<string | null> {
  if (!subject) return null
  return maskText(subject, chatScreeningRules(await gatePolicy(organizationId, projectId))).text
}

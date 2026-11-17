import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import { folderTree, isUnderOwnList } from '@/lib/authz/folder-access-rule'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { hasPassedScreening } from '@/lib/documents/document-reader'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import { documentTypeOf } from '@/lib/documents/tag-vocabulary'
import { listProjectsFolders, type OfficeFolderRow } from '@/lib/filing/repository'
import { listProjectsInOrg } from '@/lib/projects/repository'
import {
  EXTRACTOR_VERSION,
  conventionPathKey,
  extractOfficeConventions,
  type ConventionDocument,
  type ConventionFolder,
  type ConventionMove,
  type OfficeConventions,
} from './extract'
import { conventionLines, resolveLines } from './lines'
import type { OfficeConventionsView } from './office-conventions-wire'
import { asksWhereThingsAre, officeConventionsHeader, renderOfficeConventions } from './render'
import {
  claimOfficeConventionsRefresh,
  deleteConventionDecision,
  listAcceptedMoves,
  listConventionDecisions,
  listConventionDocuments,
  officeSourceFingerprint,
  readOfficeConventions,
  saveConventionDecision,
  writeOfficeConventions,
  type AcceptedMove,
} from './repository'

export const MAX_PROJECTS = 30

export const REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000

export const FINGERPRINT_TTL_MS = 60 * 1000
const FINGERPRINT_CACHE_MAX = 1000

const fingerprints = new Map<string, { value: string; readAt: number }>()

async function cachedFingerprint(organizationId: string, now: number = Date.now()): Promise<string> {
  const held = fingerprints.get(organizationId)
  if (held && now - held.readAt < FINGERPRINT_TTL_MS) return held.value
  const value = await officeSourceFingerprint(organizationId)
  fingerprints.delete(organizationId)
  fingerprints.set(organizationId, { value, readAt: now })
  if (fingerprints.size > FINGERPRINT_CACHE_MAX) fingerprints.delete(fingerprints.keys().next().value as string)
  return value
}

export function forgetOfficeFingerprints(): void {
  fingerprints.clear()
}

export async function officeConventionsEnabled(organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(FEATURE_FLAGS.officeConventions, organizationId)
}

export function openFolders(rows: readonly OfficeFolderRow[]): Map<string, ConventionFolder> {
  const byProject = new Map<string, OfficeFolderRow[]>()
  for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row])
  const open = new Map<string, ConventionFolder>()
  for (const projectRows of byProject.values()) {
    const tree = folderTree(
      projectRows.map((row) => ({ id: row.id, parentId: row.parentId, accessMode: row.accessMode, everyoneReads: false }))
    )
    for (const row of projectRows) {
      if (!isUnderOwnList(tree, row.id)) open.set(row.id, { projectId: row.projectId, path: row.path })
    }
  }
  return open
}

export function conventionDocumentOf(
  row: {
    projectId: string | null
    folderId: string | null
    filename: string
    displayName: string | null
    createdAt: Date | string
    tags?: string[] | null
    revisionFacts?: { documentNumber?: string; revision?: string }
  },
  folders: ReadonlyMap<string, ConventionFolder>
): ConventionDocument | null {
  if (!row.projectId) return null
  const folder = row.folderId ? folders.get(row.folderId) : undefined
  if (row.folderId && !folder) return null
  const docType = documentTypeOf(row.tags)
  return {
    projectId: row.projectId,
    folderPath: folder?.path ?? '',
    filename: row.displayName || row.filename,
    docType: docType && docType !== 'Sonstiges' ? docType : null,
    documentNumber: row.revisionFacts?.documentNumber ?? null,
    revision: row.revisionFacts?.revision ?? null,
    uploadedAt: new Date(row.createdAt),
  }
}

export function conventionMovesOf(
  accepted: readonly AcceptedMove[],
  documents: ReadonlyArray<{ projectId: string; filename: string; docType: string | null }>,
  folders: ReadonlyMap<string, ConventionFolder>
): ConventionMove[] {
  const typeByName = new Map<string, string>()
  for (const doc of documents) {
    if (doc.docType) typeByName.set(`${doc.projectId}\u0000${doc.filename.normalize('NFC').toLowerCase()}`, doc.docType)
  }
  const open = new Set([...folders.values()].map((folder) => `${folder.projectId}\u0000${conventionPathKey(folder.path)}`))
  return accepted.flatMap((move) => {
    const docType = typeByName.get(`${move.projectId}\u0000${move.document.normalize('NFC').toLowerCase()}`)
    if (!docType || !open.has(`${move.projectId}\u0000${conventionPathKey(move.folderPath)}`)) return []
    return [{ projectId: move.projectId, docType, folderPath: move.folderPath }]
  })
}

export async function refreshOfficeConventions(organizationId: string): Promise<OfficeConventions> {
  const fingerprint = await officeSourceFingerprint(organizationId)
  const projectIds = (await listProjectsInOrg(organizationId, { limit: MAX_PROJECTS })).map((project) => project.id)
  const [folderRows, rows, accepted] = await Promise.all([
    listProjectsFolders(organizationId, projectIds),
    listConventionDocuments(organizationId, projectIds),
    listAcceptedMoves(organizationId, projectIds),
  ])
  const folders = openFolders(folderRows)
  const enriched = await reconcileDocumentStatuses(rows, organizationId, 'read')
  const documents = enriched
    .filter(hasPassedScreening)
    .map((row) => conventionDocumentOf(row, folders))
    .filter((doc): doc is ConventionDocument => doc !== null)
  const moves = conventionMovesOf(accepted, documents, folders)
  const conventions = extractOfficeConventions({ documents, folders: [...folders.values()], moves })
  await writeOfficeConventions(organizationId, {
    conventions,
    extractorVersion: EXTRACTOR_VERSION,
    sourceFingerprint: fingerprint,
  })
  console.debug(
    `[office-conventions] ${organizationId}: ${conventions.projects} projects, ${documents.length} documents, ` +
      `${conventions.folders.length} folders, ${conventions.filing.length} filing lines, ${moves.length} accepted moves`
  )
  return conventions
}

export async function requestOfficeConventionsRefresh(organizationId: string): Promise<boolean> {
  try {
    if (!(await claimOfficeConventionsRefresh(organizationId, REFRESH_MIN_INTERVAL_MS))) return false
    void refreshOfficeConventions(organizationId).catch((error: unknown) => {
      console.warn(`[office-conventions] refreshing ${organizationId} failed; the previous count stays:`, error)
    })
    return true
  } catch (error) {
    console.warn(`[office-conventions] claiming a refresh of ${organizationId} failed:`, error)
    return false
  }
}

export function isStale(
  row: { conventions: unknown; extractorVersion: number | null; sourceFingerprint: string | null } | null,
  fingerprint: string
): boolean {
  return !row || !row.conventions || row.extractorVersion !== EXTRACTOR_VERSION || row.sourceFingerprint !== fingerprint
}

export async function officeConventionsForTurn(organizationId: string, query: string | null | undefined) {
  if (!asksWhereThingsAre(query) || !(await officeConventionsEnabled(organizationId))) return null
  const [row, fingerprint, decisions] = await Promise.all([
    readOfficeConventions(organizationId),
    cachedFingerprint(organizationId),
    listConventionDecisions(organizationId),
  ])
  if (isStale(row, fingerprint)) await requestOfficeConventionsRefresh(organizationId)
  const conventions = row?.extractorVersion === EXTRACTOR_VERSION ? row.conventions : null
  if (!conventions) return null
  const lines = renderOfficeConventions(conventions, decisions)
  return lines.length > 0 ? [officeConventionsHeader(conventions.projects), ...lines] : null
}

export async function listOfficeConventions(organizationId: string): Promise<OfficeConventionsView> {
  const [enabled, row, decisions] = await Promise.all([
    officeConventionsEnabled(organizationId),
    readOfficeConventions(organizationId),
    listConventionDecisions(organizationId),
  ])
  if (enabled && isStale(row, await cachedFingerprint(organizationId))) await requestOfficeConventionsRefresh(organizationId)
  const conventions = row?.extractorVersion === EXTRACTOR_VERSION ? row.conventions : null
  return {
    enabled,
    projects: conventions?.projects ?? 0,
    computedAt: row?.computedAt ? new Date(row.computedAt).toISOString() : null,
    lines: resolveLines(conventions ? conventionLines(conventions) : [], decisions),
  }
}

export class UnknownConventionLineError extends NotFoundError {
  constructor(readonly lineKey: string) {
    super(`No convention line has the key ${lineKey}; list the lines first.`)
  }
}

export async function decideOfficeConvention(
  organizationId: string,
  userId: string,
  input: { lineKey: string; decision: 'confirmed' | 'declined' | 'undecided' }
): Promise<void> {
  if (input.decision === 'undecided') return deleteConventionDecision(organizationId, input.lineKey)
  const view = (await listOfficeConventions(organizationId)).lines.find((entry) => entry.line.key === input.lineKey)
  if (!view) throw new UnknownConventionLineError(input.lineKey)
  await saveConventionDecision(organizationId, { lineKey: input.lineKey, decision: input.decision, line: view.line, decidedBy: userId })
}

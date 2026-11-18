import type { FileItem, FolderItem } from '../components/project-file-workspace'
import { folderMatchKey, pathSegments } from '@/lib/projects/folders'
import { documentAliasKey, documentNameKey } from '@/lib/documents/name-match'
import { documentReadFamily } from '@/lib/documents/document-status'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import { findRevisionSeries, parseRevisionName } from '@/lib/documents/revision-series'
import { screenUploadName, type NameMatch } from '@/lib/upload-screening/name-screen'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'

export type PlannedAction =
  | 'new'
  | 'update'
  | 'unchanged'
  | 'collision'
  | 'duplicate'
  | 'excluded'

export interface RevisionTarget {
  id: string
  filename: string
  name: string
  label: string
}

export interface PlannedRevision {
  candidates: RevisionTarget[]
  of: RevisionTarget
  newer: boolean
  unambiguous: boolean
  chosen: boolean
}

export interface RevisionChoice {
  chosen?: boolean
  targetId?: string
}

export interface PlannedFile {
  file: File
  originPath: string
  targetPath: string
  landsInFolderId?: string | null
  action: PlannedAction
  existingId?: string
  existingName?: string
  refiledFromFolderId?: string | null
  existingArchived?: true
  screening?: NameMatch[]
  screeningReleased?: true
  revisionOf?: PlannedRevision
}

export interface PlannedMove {
  documentId: string
  targetPath: string
}

export interface PlannedFolder {
  path: string
  existingId: string | null
}

export interface FolderUploadPlan {
  rootName: string | null
  mergedIntoCurrentFolder: boolean
  folders: PlannedFolder[]
  files: PlannedFile[]
  hashCandidates: File[]
  moves: PlannedMove[]
  counts: FolderUploadCounts
}

export interface FolderUploadCounts {
  new: number
  update: number
  unchanged: number
  collision: number
  duplicate: number
  excluded: number
  refiled: number
  foldersCreated: number
  foldersMatched: number
  uploading: number
  moving: number
}

export type PlanDocument = Pick<
  FileItem,
  'id' | 'filename' | 'displayName' | 'fileSize' | 'contentHash' | 'folderId' | 'authoredBy' | 'status'
> & { lifecycle?: FileItem['lifecycle'] }

export interface FolderUploadPlanInput {
  files: readonly File[]
  documents: readonly PlanDocument[]
  folders: readonly FolderItem[]
  currentFolderId: string | null
  digests?: ReadonlyMap<File, string>
  screening?: PlanScreening
  revisionOffers?: ReadonlyMap<string, RevisionCandidateMatch>
  revisionChoices?: ReadonlyMap<File, RevisionChoice>
}

export interface PlanScreening {
  policy: UploadScreeningPolicy
  basePath: string | null
  released?: ReadonlySet<File>
}

export function droppedPath(file: File): string {
  return file.webkitRelativePath || file.name
}

export function isFolderUpload(files: readonly File[]): boolean {
  return files.some((file) => (file.webkitRelativePath ?? '').includes('/'))
}

function pathKey(path: string): string {
  return pathSegments(path).map(folderMatchKey).join('/')
}

function archivedMark(document: PlanDocument): { existingArchived?: true } {
  return document.lifecycle === 'archived' ? { existingArchived: true } : {}
}

export function buildFolderUploadPlan(input: FolderUploadPlanInput): FolderUploadPlan {
  const { files, documents, folders, currentFolderId, digests } = input

  const currentFolder = currentFolderId
    ? (folders.find((folder) => folder.id === currentFolderId) ?? null)
    : null

  const entries = files.map((file) => ({ file, path: droppedPath(file) }))

  const rootSegments = new Set(
    entries.map((entry) => pathSegments(entry.path)[0]).filter((segment): segment is string => !!segment),
  )
  const rootName = rootSegments.size === 1 ? [...rootSegments][0] : null
  const mergedIntoCurrentFolder =
    rootName !== null &&
    currentFolder !== null &&
    folderMatchKey(rootName) === folderMatchKey(currentFolder.name) &&
    entries.every((entry) => pathSegments(entry.path).length > 1)

  const relativeDirectory = (path: string): string => {
    const segments = pathSegments(path)
    const directories = segments.slice(0, -1)
    return (mergedIntoCurrentFolder ? directories.slice(1) : directories).join('/')
  }

  const screened = new Map<File, NameMatch[]>()
  if (input.screening) {
    const { policy, basePath } = input.screening
    for (const entry of entries) {
      const relative = relativeDirectory(entry.path)
      const folderPath = [basePath, relative].filter(Boolean).join('/') || null
      const verdict = screenUploadName(policy, {
        filename: entry.file.name,
        originPath: droppedPath(entry.file),
        folderPath,
      })
      if (verdict.blocked) screened.set(entry.file, verdict.matches)
    }
  }
  const released = input.screening?.released
  const isExcluded = (file: File): boolean => screened.has(file) && !released?.has(file)
  const admitted = entries.filter((entry) => !isExcluded(entry.file))

  const basePrefix = currentFolder ? `${pathKey(currentFolder.path)}/` : ''
  const existingByRelativePath = new Map<string, string>()
  for (const folder of folders) {
    const key = pathKey(folder.path)
    if (basePrefix) {
      if (!key.startsWith(basePrefix)) continue
      existingByRelativePath.set(key.slice(basePrefix.length), folder.id)
    } else {
      existingByRelativePath.set(key, folder.id)
    }
  }

  const neededPaths = new Set<string>()
  for (const entry of admitted) {
    const directory = relativeDirectory(entry.path)
    if (!directory) continue
    const segments = directory.split('/')
    for (let depth = 1; depth <= segments.length; depth += 1) {
      neededPaths.add(segments.slice(0, depth).join('/'))
    }
  }
  const plannedFolders: PlannedFolder[] = [...neededPaths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, existingId: existingByRelativePath.get(pathKey(path)) ?? null }))

  const byName = new Map<string, PlanDocument>()
  const byAlias = new Map<string, PlanDocument>()
  for (const document of documents) {
    if (document.authoredBy === 'agent') continue
    const key = documentNameKey(document.filename)
    if (!byName.has(key)) byName.set(key, document)
    for (const alias of [document.filename, document.displayName]) {
      if (!alias) continue
      const aliasKey = documentAliasKey(alias)
      if (!byAlias.has(aliasKey)) byAlias.set(aliasKey, document)
    }
  }

  const dropNameCounts = new Map<string, number>()
  for (const entry of admitted) {
    const key = documentNameKey(entry.file.name)
    dropNameCounts.set(key, (dropNameCounts.get(key) ?? 0) + 1)
  }

  const matchedName = (document: PlanDocument, droppedName: string): string | undefined => {
    const shown = document.displayName ?? document.filename
    return documentNameKey(shown) === documentNameKey(droppedName) ? undefined : shown
  }

  const landsIn = (targetPath: string): string | null => {
    const segments = targetPath ? targetPath.split('/') : []
    for (let depth = segments.length; depth > 0; depth -= 1) {
      const existing = existingByRelativePath.get(pathKey(segments.slice(0, depth).join('/')))
      if (existing) return existing
    }
    return currentFolderId ?? null
  }

  const hashCandidates: File[] = []
  const moves: PlannedMove[] = []
  const contested = contestedOffers(admitted.map((entry) => entry.file), input.revisionOffers)
  const plannedFiles: PlannedFile[] = entries.map(({ file, path }) => {
    const matches = screened.get(file)
    if (matches && isExcluded(file)) {
      const targetPath = relativeDirectory(path)
      return { file, originPath: path, targetPath, landsInFolderId: landsIn(targetPath), action: 'excluded', screening: matches }
    }
    const planned = withRevision(planAdmitted(file, path), input, contested)
    return matches ? { ...planned, screening: matches, screeningReleased: true } : planned
  })

  function planAdmitted(file: File, path: string): PlannedFile {
    const targetPath = relativeDirectory(path)
    const targetExists = targetPath ? existingByRelativePath.has(pathKey(targetPath)) : true
    const targetFolderId = targetPath
      ? (existingByRelativePath.get(pathKey(targetPath)) ?? null)
      : (currentFolderId ?? null)
    const base: PlannedFile = { file, originPath: path, targetPath, landsInFolderId: landsIn(targetPath), action: 'new' }
    const nameKey = documentNameKey(file.name)

    if ((dropNameCounts.get(nameKey) ?? 0) > 1) {
      return { ...base, action: 'collision' }
    }

    const existing = byName.get(nameKey)
    if (!existing) {
      const alias = byAlias.get(documentAliasKey(file.name))
      if (!alias) return base
      return {
        ...base,
        action: 'duplicate',
        existingId: alias.id,
        existingName: alias.displayName ?? alias.filename,
        ...archivedMark(alias),
      }
    }

    const refiled = !targetExists || (existing.folderId ?? null) !== targetFolderId
    const shownAs = matchedName(existing, file.name)

    const sameSize = existing.fileSize === file.size
    const storedDigest = existing.contentHash ?? null

    const family = documentReadFamily(existing.status)
    const retries = family === 'failed' || family === 'unindexed'

    if (sameSize && storedDigest && !retries) {
      const digest = digests?.get(file)
      if (digest === undefined) {
        hashCandidates.push(file)
      } else if (digest === storedDigest) {
        if (refiled) moves.push({ documentId: existing.id, targetPath })
        return {
          ...base,
          action: 'unchanged',
          existingId: existing.id,
          ...(shownAs ? { existingName: shownAs } : {}),
          ...archivedMark(existing),
          ...(refiled ? { refiledFromFolderId: existing.folderId ?? null } : {}),
        }
      }
    }

    return {
      ...base,
      action: 'update',
      existingId: existing.id,
      ...(shownAs ? { existingName: shownAs } : {}),
      ...archivedMark(existing),
      ...(refiled ? { refiledFromFolderId: existing.folderId ?? null } : {}),
    }
  }

  return {
    rootName,
    mergedIntoCurrentFolder,
    folders: plannedFolders,
    files: plannedFiles,
    hashCandidates,
    moves,
    counts: countPlan(plannedFiles, plannedFolders, true),
  }
}

function contestedOffers(
  files: readonly File[],
  offers: ReadonlyMap<string, RevisionCandidateMatch> | undefined,
): ReadonlySet<File> {
  const contested = new Set<File>()
  if (!offers) return contested
  const byDocument = new Map<string, File[]>()
  for (const file of files) {
    const offer = offers.get(file.name)
    if (offer) byDocument.set(offer.candidates[0].id, [...(byDocument.get(offer.candidates[0].id) ?? []), file])
  }
  for (const group of byDocument.values()) {
    if (group.length < 2) continue
    const newest = new Set(
      findRevisionSeries(group.map((file) => ({ filename: file.name, file }))).map((series) => series.current.item.file),
    )
    for (const file of group) if (!newest.has(file)) contested.add(file)
  }
  return contested
}

function withRevision(planned: PlannedFile, input: FolderUploadPlanInput, contested: ReadonlySet<File>): PlannedFile {
  const offer = planned.action === 'new' ? input.revisionOffers?.get(planned.file.name) : undefined
  if (!offer) return planned
  const candidates: RevisionTarget[] = offer.candidates.map((candidate) => ({
    id: candidate.id,
    filename: candidate.filename,
    name: candidate.displayName ?? candidate.filename,
    label: candidate.label,
  }))
  const unambiguous = offer.unambiguous && !contested.has(planned.file)
  const choice = input.revisionChoices?.get(planned.file)
  return {
    ...planned,
    revisionOf: {
      candidates,
      of: candidates.find((candidate) => candidate.id === choice?.targetId) ?? candidates[0],
      newer: offer.newer,
      unambiguous,
      chosen: choice?.chosen ?? unambiguous,
    },
  }
}

export function continuesASeries(name: string): boolean {
  return parseRevisionName(name) !== null
}

export function countPlan(
  files: readonly PlannedFile[],
  folders: readonly PlannedFolder[],
  includeUpdates: boolean,
): FolderUploadCounts {
  const counts: FolderUploadCounts = {
    new: 0,
    update: 0,
    unchanged: 0,
    collision: 0,
    duplicate: 0,
    excluded: 0,
    refiled: 0,
    foldersCreated: 0,
    foldersMatched: 0,
    uploading: 0,
    moving: 0,
  }
  for (const file of files) {
    counts[file.action] += 1
    if (file.refiledFromFolderId === undefined) continue
    if (file.action === 'update') counts.refiled += 1
    if (file.action === 'unchanged') counts.moving += 1
  }
  for (const folder of folders) {
    if (folder.existingId === null) counts.foldersCreated += 1
    else counts.foldersMatched += 1
  }
  counts.uploading = counts.new + (includeUpdates ? counts.update : 0)
  return counts
}

export function needsUploadDecision(plan: Pick<FolderUploadPlan, 'files'>): boolean {
  return plan.files.some((file) => file.action !== 'new' || file.revisionOf !== undefined)
}

export function filesToUpload(
  plan: FolderUploadPlan,
  includeUpdates: boolean,
): PlannedFile[] {
  return plan.files.filter(
    (file) => file.action === 'new' || (includeUpdates && file.action === 'update'),
  )
}

export function samePlanOutcome(a: FolderUploadPlan, b: FolderUploadPlan): boolean {
  const fileKey = (planned: PlannedFile): string =>
    `${planned.action}\u0000${planned.targetPath}\u0000${planned.revisionOf?.of.id ?? ''}\u0000${planned.revisionOf?.chosen ?? ''}`
  return (
    a.files.length === b.files.length &&
    a.files.every((planned, index) => planned.file === b.files[index].file && fileKey(planned) === fileKey(b.files[index])) &&
    a.folders.length === b.folders.length &&
    a.folders.every((folder, index) => folder.path === b.folders[index].path && folder.existingId === b.folders[index].existingId) &&
    a.moves.length === b.moves.length &&
    a.moves.every((move, index) => move.documentId === b.moves[index].documentId && move.targetPath === b.moves[index].targetPath)
  )
}

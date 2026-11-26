import type { FileItem, FolderItem } from '../components/project-file-workspace'
import { folderMatchKey, pathSegments } from '@/lib/projects/folders'
import { documentNameKey } from '@/lib/documents/name-match'
import { documentReadFamily } from '@/lib/documents/document-status'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import { findRevisionSeries, parseRevisionName } from '@/lib/documents/revision-series'
import { screenUploadName, type NameMatch } from '@/lib/upload-screening/name-screen'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { nameMatchKey, nextFreeDocumentName, type ConflictChoice, type SentConflictChoice } from './name-conflict'

export type PlannedAction = 'new' | 'update' | 'unchanged' | 'collision' | 'excluded'

export interface PlannedConflict {
  within: 'folder' | 'drop'
  choice: ConflictChoice
  keepBothAs: string
}

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
  existingArchived?: true
  conflict?: PlannedConflict
  onConflict?: SentConflictChoice
  screening?: NameMatch[]
  screeningReleased?: true
  revisionOf?: PlannedRevision
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
  counts: FolderUploadCounts
}

export interface FolderUploadCounts {
  new: number
  update: number
  unchanged: number
  collision: number
  excluded: number
  skipped: number
  foldersCreated: number
  foldersMatched: number
  uploading: number
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
  conflictChoices?: ReadonlyMap<File, ConflictChoice>
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

  const folderKeyOf = (targetPath: string): string => {
    if (!targetPath) return `id:${currentFolderId ?? ''}`
    const existing = existingByRelativePath.get(pathKey(targetPath))
    return existing ? `id:${existing}` : `new:${pathKey(targetPath)}`
  }

  const heldByFilename = new Map<string, Map<string, PlanDocument[]>>()
  const heldByDisplayName = new Map<string, Map<string, PlanDocument[]>>()
  const taken = new Map<string, Set<string>>()
  const takenIn = (folderKey: string): Set<string> => {
    const existing = taken.get(folderKey)
    if (existing) return existing
    const created = new Set<string>()
    taken.set(folderKey, created)
    return created
  }
  const hold = (index: Map<string, Map<string, PlanDocument[]>>, folderKey: string, name: string, document: PlanDocument) => {
    const key = nameMatchKey(name)
    const names = index.get(folderKey) ?? new Map<string, PlanDocument[]>()
    names.set(key, [...(names.get(key) ?? []), document])
    index.set(folderKey, names)
    takenIn(folderKey).add(key)
  }
  for (const document of documents) {
    if (document.authoredBy === 'agent') continue
    const folderKey = `id:${document.folderId ?? ''}`
    hold(heldByFilename, folderKey, document.filename, document)
    if (document.displayName) hold(heldByDisplayName, folderKey, document.displayName, document)
  }

  const holderOf = (folderKey: string, name: string): PlanDocument | undefined => {
    const key = nameMatchKey(name)
    const byFilename = heldByFilename.get(folderKey)?.get(key) ?? []
    const exact = byFilename.find((document) => documentNameKey(document.filename) === documentNameKey(name))
    return exact ?? byFilename[0] ?? heldByDisplayName.get(folderKey)?.get(key)?.[0]
  }

  const dropGroups = new Map<string, File[]>()
  for (const entry of admitted) {
    const folderKey = folderKeyOf(relativeDirectory(entry.path))
    const key = `${folderKey}\u0000${nameMatchKey(entry.file.name)}`
    dropGroups.set(key, [...(dropGroups.get(key) ?? []), entry.file])
    takenIn(folderKey).add(nameMatchKey(entry.file.name))
  }

  const keepBothName = (folderKey: string, name: string): string => {
    const names = takenIn(folderKey)
    const suggested = nextFreeDocumentName(name, names)
    names.add(nameMatchKey(suggested))
    return suggested
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
    const folderKey = folderKeyOf(targetPath)
    const base: PlannedFile = { file, originPath: path, targetPath, landsInFolderId: landsIn(targetPath), action: 'new' }
    const group = dropGroups.get(`${folderKey}\u0000${nameMatchKey(file.name)}`) ?? [file]
    const existing = holderOf(folderKey, file.name)
    const shownAs = existing ? matchedName(existing, file.name) : undefined
    const held = existing
      ? { existingId: existing.id, ...(shownAs ? { existingName: shownAs } : {}), ...archivedMark(existing) }
      : {}

    if (group[0] !== file) {
      const asked = input.conflictChoices?.get(file)
      const choice: ConflictChoice = asked === 'skip' ? 'skip' : 'keep_both'
      return {
        ...base,
        ...held,
        action: 'collision',
        conflict: { within: 'drop', choice, keepBothAs: keepBothName(folderKey, file.name) },
        ...(choice === 'skip' ? {} : { onConflict: 'keep_both' }),
      }
    }

    if (!existing) return group.length > 1 ? { ...base, onConflict: 'keep_both' } : base

    const sameSize = existing.fileSize === file.size
    const storedDigest = existing.contentHash ?? null

    const family = documentReadFamily(existing.status)
    const retries = family === 'failed' || family === 'unindexed'

    if (sameSize && storedDigest && !retries) {
      const digest = digests?.get(file)
      if (digest === undefined) {
        hashCandidates.push(file)
      } else if (digest === storedDigest) {
        return { ...base, ...held, action: 'unchanged' }
      }
    }

    const choice = input.conflictChoices?.get(file) ?? 'replace'
    return {
      ...base,
      ...held,
      action: 'update',
      conflict: { within: 'folder', choice, keepBothAs: keepBothName(folderKey, file.name) },
      ...(choice === 'skip' ? {} : { onConflict: choice }),
    }
  }

  return {
    rootName,
    mergedIntoCurrentFolder,
    folders: plannedFolders,
    files: plannedFiles,
    hashCandidates,
    counts: countPlan(plannedFiles, plannedFolders),
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

export function countPlan(files: readonly PlannedFile[], folders: readonly PlannedFolder[]): FolderUploadCounts {
  const counts: FolderUploadCounts = {
    new: 0,
    update: 0,
    unchanged: 0,
    collision: 0,
    excluded: 0,
    skipped: 0,
    foldersCreated: 0,
    foldersMatched: 0,
    uploading: 0,
  }
  for (const file of files) {
    counts[file.action] += 1
    if (file.conflict?.choice === 'skip') counts.skipped += 1
  }
  for (const folder of folders) {
    if (folder.existingId === null) counts.foldersCreated += 1
    else counts.foldersMatched += 1
  }
  counts.uploading = counts.new + counts.update + counts.collision - counts.skipped
  return counts
}

export function needsUploadDecision(plan: Pick<FolderUploadPlan, 'files'>): boolean {
  return plan.files.some((file) => file.action !== 'new' || file.revisionOf !== undefined)
}

export function filesToUpload(plan: Pick<FolderUploadPlan, 'files'>): PlannedFile[] {
  return plan.files.filter((file) => file.action === 'new' || (file.conflict !== undefined && file.conflict.choice !== 'skip'))
}

export function conflictedFiles(plan: Pick<FolderUploadPlan, 'files'>): PlannedFile[] {
  return plan.files.filter((file) => file.conflict !== undefined)
}

export function samePlanOutcome(a: FolderUploadPlan, b: FolderUploadPlan): boolean {
  const fileKey = (planned: PlannedFile): string =>
    [planned.action, planned.targetPath, planned.revisionOf?.of.id ?? '', planned.revisionOf?.chosen ?? '', planned.onConflict ?? ''].join('\u0000')
  return (
    a.files.length === b.files.length &&
    a.files.every((planned, index) => planned.file === b.files[index].file && fileKey(planned) === fileKey(b.files[index])) &&
    a.folders.length === b.folders.length &&
    a.folders.every((folder, index) => folder.path === b.folders[index].path && folder.existingId === b.folders[index].existingId)
  )
}

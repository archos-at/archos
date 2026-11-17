import { documentReadFamily, type DocumentReadFamily } from '@/lib/documents/document-status'
import type { ShelfSummary } from '@/lib/documents/shelf-summary-types'
import { DISCIPLINE_TAGS, DOCUMENT_TYPE_TAGS, documentTypeOf } from '@/lib/documents/tag-vocabulary'
import type { FileItem, FolderItem } from '../file-types'
import { withoutOlderRevisions } from './revision-chain'

export type ReadState = DocumentReadFamily

export function readStateOf(status: string | null | undefined): ReadState {
  return documentReadFamily(status)
}

export function isUnplaced(file: Pick<FileItem, 'status' | 'tags'>): boolean {
  return readStateOf(file.status) === 'readable' && documentTypeOf(file.tags) === undefined
}

export interface KnowledgeTally {
  total: number
  readable: number
  reading: number
  failed: number
  held: number
  unindexed: number
  unplaced: number
  pages: number
  latest: string | null
}

export function emptyTally(): KnowledgeTally {
  return { total: 0, readable: 0, reading: 0, failed: 0, held: 0, unindexed: 0, unplaced: 0, pages: 0, latest: null }
}

function addFile(tally: KnowledgeTally, file: FileItem): void {
  const state = readStateOf(file.status)
  tally.total += 1
  tally[state] += 1
  if (state === 'readable') {
    if (documentTypeOf(file.tags) === undefined) tally.unplaced += 1
    if (typeof file.pageCount === 'number' && file.pageCount > 0) tally.pages += file.pageCount
  }
  if (file.createdAt && (tally.latest === null || file.createdAt > tally.latest)) tally.latest = file.createdAt
}

function addTally(into: KnowledgeTally, from: KnowledgeTally): void {
  into.total += from.total
  into.readable += from.readable
  into.reading += from.reading
  into.failed += from.failed
  into.held += from.held
  into.unindexed += from.unindexed
  into.unplaced += from.unplaced
  into.pages += from.pages
  if (from.latest && (into.latest === null || from.latest > into.latest)) into.latest = from.latest
}

export function tallyOf(files: readonly FileItem[]): KnowledgeTally {
  const tally = emptyTally()
  for (const file of files) addFile(tally, file)
  return tally
}

export function readShare(tally: KnowledgeTally): number | null {
  const meantToRead = tally.total - tally.unindexed
  return meantToRead > 0 ? tally.readable / meantToRead : null
}

export function subtreeTallies(
  files: readonly FileItem[],
  folders: readonly FolderItem[]
): Map<string, KnowledgeTally> {
  return foldTallies(directTallies(files), folders)
}

function directTallies(files: readonly FileItem[]): Map<string, KnowledgeTally> {
  const direct = new Map<string, KnowledgeTally>()
  for (const file of files) {
    if (file.folderId == null) continue
    let tally = direct.get(file.folderId)
    if (!tally) direct.set(file.folderId, (tally = emptyTally()))
    addFile(tally, file)
  }
  return direct
}

export function foldTallies(
  direct: ReadonlyMap<string | null, KnowledgeTally>,
  folders: readonly FolderItem[]
): Map<string, KnowledgeTally> {
  const childrenByParent = childrenIndex(folders)
  const result = new Map<string, KnowledgeTally>()
  const visited = new Set<string>()
  for (const root of folders) {
    if (visited.has(root.id)) continue
    const stack: Array<{ id: string; expanded: boolean }> = [{ id: root.id, expanded: false }]
    while (stack.length > 0) {
      const frame = stack.pop()!
      if (!frame.expanded) {
        if (visited.has(frame.id)) continue
        visited.add(frame.id)
        stack.push({ id: frame.id, expanded: true })
        for (const child of childrenByParent.get(frame.id) ?? []) {
          if (!visited.has(child.id)) stack.push({ id: child.id, expanded: false })
        }
        continue
      }
      const tally = emptyTally()
      const own = direct.get(frame.id)
      if (own) addTally(tally, own)
      for (const child of childrenByParent.get(frame.id) ?? []) {
        const nested = result.get(child.id)
        if (nested) addTally(tally, nested)
      }
      result.set(frame.id, tally)
    }
  }
  return result
}

export function tallyFromSummaryRow(row: ShelfSummary['folders'][number]): KnowledgeTally {
  return {
    total: row.total,
    readable: row.readable,
    reading: row.reading,
    failed: row.failed,
    held: row.held,
    unindexed: row.unindexed,
    unplaced: 0,
    pages: 0,
    latest: row.latest,
  }
}

export interface SummaryTallies {
  direct: Map<string | null, KnowledgeTally>
  subtree: Map<string, KnowledgeTally>
  total: number
}

export function talliesFromSummary(summary: ShelfSummary, folders: readonly FolderItem[]): SummaryTallies {
  const direct = new Map<string | null, KnowledgeTally>()
  let total = 0
  for (const row of summary.folders) {
    direct.set(row.folderId, tallyFromSummaryRow(row))
    total += row.total
  }
  return { direct, subtree: foldTallies(direct, folders), total }
}

function childrenIndex(folders: readonly FolderItem[]): Map<string, FolderItem[]> {
  const index = new Map<string, FolderItem[]>()
  for (const folder of folders) {
    if (folder.parentId === null) continue
    const bucket = index.get(folder.parentId)
    if (bucket) bucket.push(folder)
    else index.set(folder.parentId, [folder])
  }
  return index
}

export function subtreeFolderIds(folders: readonly FolderItem[], rootId: string | null): Set<string> | null {
  if (rootId === null) return null
  const childrenByParent = childrenIndex(folders)
  const ids = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const child of childrenByParent.get(id) ?? []) {
      if (ids.has(child.id)) continue
      ids.add(child.id)
      stack.push(child.id)
    }
  }
  return ids
}

export function filesInSubtree<T extends FileItem>(
  files: readonly T[],
  folders: readonly FolderItem[],
  folderId: string | null
): readonly T[] {
  const ids = subtreeFolderIds(folders, folderId)
  if (ids === null) return files
  return files.filter((file) => file.folderId != null && ids.has(file.folderId))
}

export interface CountedLabel {
  label: string
  count: number
}

export interface FolderLocation {
  folder: FolderItem
  trail: string[]
  tally: KnowledgeTally
}

export interface BriefDocument {
  id: string
}

export interface FolderBrief {
  tally: KnowledgeTally
  partial?: boolean
  files: readonly FileItem[]
  documentTypes: CountedLabel[]
  disciplines: CountedLabel[]
  contents: CountedLabel[]
  attention: {
    failed: BriefDocument[]
    held: BriefDocument[]
    unplaced: BriefDocument[]
  }
  reading: FileItem[]
  hotspots: FolderLocation[]
  topics: CountedLabel[]
  photos: PhotoSpan | null
}

export interface PhotoSpan {
  count: number
  from: string
  to: string
  located: number
}

export const MAX_HOTSPOTS = 4
export const MAX_BRIEF_TOPICS = 12

const CATCH_ALL_TYPE = 'Sonstiges'

function countLabels(counts: Map<string, number>, order: readonly string[]): CountedLabel[] {
  const rank = (label: string) => {
    const index = order.indexOf(label)
    return index === -1 ? order.length : index
  }
  const last = (label: string) => (label === CATCH_ALL_TYPE ? 1 : 0)
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        last(a.label) - last(b.label) ||
        b.count - a.count ||
        rank(a.label) - rank(b.label) ||
        a.label.localeCompare(b.label)
    )
}

const CONTENT_ORDER = ['text', 'table', 'image', 'chart', 'drawing']

function compareSeverity(a: KnowledgeTally, b: KnowledgeTally): number {
  return b.failed - a.failed || b.held - a.held || b.reading - a.reading || b.unplaced - a.unplaced
}

export function buildFolderBrief(
  allFiles: readonly FileItem[],
  folders: readonly FolderItem[],
  folderId: string | null
): FolderBrief {
  const files = withoutOlderRevisions(allFiles, false)
  const subtree = filesInSubtree(files, folders, folderId)
  const tally = tallyOf(subtree)

  const types = new Map<string, number>()
  const disciplines = new Map<string, number>()
  const contents = new Map<string, number>()
  const topics = new Map<string, number>()
  const captured: string[] = []
  let located = 0
  const attention: FolderBrief['attention'] = { failed: [], held: [], unplaced: [] }
  const reading: FileItem[] = []
  const typeSet = new Set<string>(DOCUMENT_TYPE_TAGS)
  const disciplineSet = new Set<string>(DISCIPLINE_TAGS)

  for (const file of subtree) {
    const state = readStateOf(file.status)
    if (state === 'failed') attention.failed.push(file)
    else if (state === 'held') attention.held.push(file)
    else if (state === 'reading') reading.push(file)
    if (state !== 'readable') continue
    if (documentTypeOf(file.tags) === undefined) attention.unplaced.push(file)
    for (const tag of new Set(file.tags ?? [])) {
      if (typeSet.has(tag)) types.set(tag, (types.get(tag) ?? 0) + 1)
      else if (disciplineSet.has(tag)) disciplines.set(tag, (disciplines.get(tag) ?? 0) + 1)
    }
    for (const content of new Set(file.contentTypes ?? [])) {
      contents.set(content, (contents.get(content) ?? 0) + 1)
    }
    for (const topic of new Set(file.topics ?? [])) {
      topics.set(topic, (topics.get(topic) ?? 0) + 1)
    }
    const capturedAt = file.capture?.capturedAt
    if (capturedAt) {
      captured.push(capturedAt.slice(0, 10))
      if (file.capture?.latitude !== undefined && file.capture?.longitude !== undefined) located += 1
    }
  }
  captured.sort()

  return {
    tally,
    files: subtree,
    documentTypes: countLabels(types, DOCUMENT_TYPE_TAGS),
    disciplines: countLabels(disciplines, DISCIPLINE_TAGS),
    contents: countLabels(contents, CONTENT_ORDER),
    attention,
    reading,
    hotspots: findHotspots(files, folders, folderId),
    topics: countLabels(topics, []).slice(0, MAX_BRIEF_TOPICS),
    photos:
      captured.length > 0
        ? { count: captured.length, from: captured[0], to: captured[captured.length - 1], located }
        : null,
  }
}

function findHotspots(
  files: readonly FileItem[],
  folders: readonly FolderItem[],
  folderId: string | null
): FolderLocation[] {
  return hotspotsFrom(directTallies(files), folders, folderId)
}

function hotspotsFrom(
  direct: ReadonlyMap<string | null, KnowledgeTally>,
  folders: readonly FolderItem[],
  folderId: string | null
): FolderLocation[] {
  const below = subtreeFolderIds(folders, folderId)
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const spots: FolderLocation[] = []
  for (const [id, tally] of direct) {
    if (id === null || id === folderId) continue
    const folder = byId.get(id)
    if (!folder) continue
    if (below !== null && !below.has(id)) continue
    if (tally.failed + tally.held + tally.reading + tally.unplaced === 0) continue
    spots.push({ folder, trail: trailBetween(byId, folder, folderId), tally })
  }
  return spots
    .sort((a, b) => compareSeverity(a.tally, b.tally) || a.folder.name.localeCompare(b.folder.name))
    .slice(0, MAX_HOTSPOTS)
}

export function buildFolderBriefFromSummary(
  summary: ShelfSummary,
  folders: readonly FolderItem[],
  folderId: string | null
): FolderBrief {
  const { direct } = talliesFromSummary(summary, folders)
  const ids = subtreeFolderIds(folders, folderId)
  const inSubtree = (id: string | null): boolean => ids === null || (id !== null && ids.has(id))
  const tally = emptyTally()
  for (const [id, own] of direct) {
    if (inSubtree(id)) addTally(tally, own)
  }
  return {
    tally,
    partial: true,
    files: [],
    documentTypes: [],
    disciplines: [],
    contents: [],
    attention: {
      failed: summary.failed.filter((document) => inSubtree(document.folderId)).map((document) => ({ id: document.id })),
      held: [],
      unplaced: [],
    },
    reading: [],
    hotspots: hotspotsFrom(direct, folders, folderId),
    topics: [],
    photos: null,
  }
}

function trailBetween(byId: Map<string, FolderItem>, folder: FolderItem, stopAt: string | null): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  let current: FolderItem | undefined = folder
  while (current && current.id !== stopAt && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return names
}

export type BriefSelection =
  | { kind: 'state'; state: ReadState }
  | { kind: 'tag'; tag: string }
  | { kind: 'topic'; topic: string }
  | { kind: 'unplaced' }
  | { kind: 'photos' }

export function selectInBrief(brief: FolderBrief, selection: BriefSelection): FileItem[] {
  return brief.files.filter((file) => matchesBriefSelection(file, selection))
}

export function matchesBriefSelection(file: FileItem, selection: BriefSelection): boolean {
  const readable = readStateOf(file.status) === 'readable'
  switch (selection.kind) {
    case 'state':
      return readStateOf(file.status) === selection.state
    case 'tag':
      return readable && (file.tags ?? []).includes(selection.tag)
    case 'topic':
      return readable && (file.topics ?? []).includes(selection.topic)
    case 'photos':
      return readable && Boolean(file.capture?.capturedAt)
    case 'unplaced':
      return isUnplaced(file)
  }
}

export interface ReadMark {
  state: 'failed' | 'held' | 'reading' | 'unplaced' | 'allRead'
  count: number
}

export function readMarkOf(tally: KnowledgeTally, { withUnplaced = false } = {}): ReadMark | null {
  if (tally.failed > 0) return { state: 'failed', count: tally.failed }
  if (tally.held > 0) return { state: 'held', count: tally.held }
  if (tally.reading > 0) return { state: 'reading', count: tally.reading }
  if (withUnplaced && tally.unplaced > 0) return { state: 'unplaced', count: tally.unplaced }
  if (tally.readable > 0) return { state: 'allRead', count: tally.readable }
  return null
}

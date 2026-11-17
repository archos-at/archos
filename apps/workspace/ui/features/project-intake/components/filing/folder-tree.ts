import { droppedPath } from '@/features/documents/lib/folder-upload-plan'
import { isSystemFile } from '@/features/documents/lib/system-files'
import { pathSegments } from '@/lib/projects/folders'
import { screenUploadName, type NameMatch } from '@/lib/upload-screening/name-screen'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { exclusionReason, type ExclusionReason } from './default-exclusions'

export interface FolderNode {
  path: string
  name: string
  depth: number
  children: FolderNode[]
  fileCount: number
  size: number
  ownFiles: number
}

export interface TreeFile {
  file: File
  path: string
  folder: string
}

export interface ChosenTree {
  root: FolderNode
  files: TreeFile[]
  byPath: ReadonlyMap<string, FolderNode>
}

export type ExcludedFolders = ReadonlySet<string>

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

function emptyNode(path: string, name: string, depth: number): FolderNode {
  return { path, name, depth, children: [], fileCount: 0, size: 0, ownFiles: 0 }
}

function sortTree(node: FolderNode): void {
  node.children.sort((a, b) => collator.compare(a.name, b.name))
  for (const child of node.children) sortTree(child)
}

export function buildChosenTree(chosen: readonly File[]): ChosenTree {
  const root = emptyNode('', '', 0)
  const byPath = new Map<string, FolderNode>([['', root]])
  const files: TreeFile[] = []
  for (const file of chosen) {
    if (isSystemFile(file.name)) continue
    const path = droppedPath(file)
    const directories = pathSegments(path).slice(0, -1)
    const chain: FolderNode[] = [root]
    let parent = root
    for (const [index, name] of directories.entries()) {
      const folderPath = directories.slice(0, index + 1).join('/')
      let node = byPath.get(folderPath)
      if (!node) {
        node = emptyNode(folderPath, name, index + 1)
        byPath.set(folderPath, node)
        parent.children.push(node)
      }
      chain.push(node)
      parent = node
    }
    for (const node of chain) {
      node.fileCount += 1
      node.size += file.size
    }
    parent.ownFiles += 1
    files.push({ file, path, folder: parent.path })
  }
  sortTree(root)
  return { root, files, byPath }
}

function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

const isBelow = (path: string, folder: string): boolean => folder !== '' && path.startsWith(`${folder}/`)

export function isFolderExcluded(excluded: ExcludedFolders, path: string): boolean {
  if (path === '') return false
  return excluded.has(path) || ancestorsOf(path).some((ancestor) => excluded.has(ancestor))
}

export function folderState(excluded: ExcludedFolders, path: string): 'in' | 'out' | 'partial' {
  if (isFolderExcluded(excluded, path)) return 'out'
  for (const folder of excluded) if (path === '' || isBelow(folder, path)) return 'partial'
  return 'in'
}

export function toggleFolder(tree: ChosenTree, excluded: ExcludedFolders, path: string): Set<string> {
  const next = new Set(excluded)
  if (path === '') return next
  if (!isFolderExcluded(excluded, path)) {
    for (const folder of excluded) if (isBelow(folder, path)) next.delete(folder)
    next.add(path)
    return next
  }
  next.delete(path)
  for (const folder of excluded) if (isBelow(folder, path)) next.delete(folder)
  const chain = ancestorsOf(path)
  const outerOut = chain.findIndex((ancestor) => excluded.has(ancestor))
  if (outerOut < 0) return next
  const way = [...chain.slice(outerOut), path]
  for (let index = 0; index < way.length - 1; index += 1) {
    const folder = way[index] as string
    next.delete(folder)
    const node = tree.byPath.get(folder)
    for (const child of node?.children ?? []) if (child.path !== way[index + 1]) next.add(child.path)
  }
  return next
}

export function proposedExclusions(tree: ChosenTree): Map<string, ExclusionReason> {
  const proposed = new Map<string, ExclusionReason>()
  const visit = (node: FolderNode): void => {
    for (const child of node.children) {
      const reason = exclusionReason(child.name)
      if (reason) proposed.set(child.path, reason)
      else visit(child)
    }
  }
  visit(tree.root)
  return proposed
}

export function chosenFiles(tree: ChosenTree, excluded: ExcludedFolders): TreeFile[] {
  return tree.files.filter((entry) => !isFolderExcluded(excluded, entry.folder))
}

export interface ChoiceSummary {
  files: number
  size: number
  totalFiles: number
  totalSize: number
}

export function summarizeChoice(tree: ChosenTree, excluded: ExcludedFolders): ChoiceSummary {
  const kept = chosenFiles(tree, excluded)
  return {
    files: kept.length,
    size: kept.reduce((sum, entry) => sum + entry.file.size, 0),
    totalFiles: tree.root.fileCount,
    totalSize: tree.root.size,
  }
}

export interface HeldBackTerm {
  term: string
  files: number
  folders: string[]
}

export interface ScreeningPreview {
  held: Array<TreeFile & { matches: NameMatch[] }>
  byTerm: HeldBackTerm[]
  heldIn: ReadonlyMap<string, number>
}

export function previewScreening(
  tree: ChosenTree,
  excluded: ExcludedFolders,
  policy: UploadScreeningPolicy
): ScreeningPreview {
  const held: ScreeningPreview['held'] = []
  const heldIn = new Map<string, number>()
  const terms = new Map<string, { files: number; folders: Set<string> }>()
  for (const entry of chosenFiles(tree, excluded)) {
    const folderPath = entry.folder || null
    const verdict = screenUploadName(policy, { filename: entry.file.name, originPath: entry.path, folderPath })
    if (!verdict.blocked) continue
    held.push({ ...entry, matches: verdict.matches })
    const on = entry.folder ? [...ancestorsOf(entry.folder), entry.folder] : []
    for (const folder of ['', ...on]) heldIn.set(folder, (heldIn.get(folder) ?? 0) + 1)
    for (const term of new Set(verdict.matches.map((match) => match.term))) {
      const tally = terms.get(term) ?? { files: 0, folders: new Set<string>() }
      tally.files += 1
      tally.folders.add(entry.folder)
      terms.set(term, tally)
    }
  }
  const byTerm = [...terms.entries()]
    .map(([term, tally]) => ({ term, files: tally.files, folders: [...tally.folders].sort(collator.compare) }))
    .sort((a, b) => b.files - a.files || collator.compare(a.term, b.term))
  return { held, byTerm, heldIn }
}

export function accessFolders(tree: ChosenTree): FolderNode[] {
  const [only] = tree.root.children
  if (tree.root.children.length === 1 && only && tree.root.ownFiles === 0 && only.children.length > 0) {
    return only.children
  }
  return tree.root.children
}

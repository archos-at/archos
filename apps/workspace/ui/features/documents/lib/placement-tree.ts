import {
  certaintyOf,
  type KeptMove,
  type NewFolderProposal,
  type PlacementCertainty,
  type RootSortDocument,
  type RootSortFolder,
  type RootSortPlacement,
} from '@/lib/filing/root-sort-types'

export interface PlacementState {
  excluded: ReadonlySet<string>
  excludedNewFolders: ReadonlySet<string>
  retargets: ReadonlyMap<string, string | null>
}

export const NO_CHANGES: PlacementState = {
  excluded: new Set(),
  excludedNewFolders: new Set(),
  retargets: new Map(),
}

export interface PlacementInput {
  folders: readonly RootSortFolder[]
  documents: readonly RootSortDocument[]
  placements: readonly RootSortPlacement[]
  newFolders: readonly NewFolderProposal[]
}

export type RetargetChoice =
  { kind: 'folder'; folderId: string } | { kind: 'root' } | { kind: 'proposal' }

export interface FileNode {
  kind: 'file'
  id: string
  name: string
  reason: string
  confidence: number | null
  certainty: PlacementCertainty | null
  included: boolean
  chosenByPerson: boolean
}

export interface FolderNode {
  kind: 'folder'
  path: string
  folderId: string | null
  name: string
  depth: number
  isNew: boolean
  switchedOff: boolean
  files: FileNode[]
  children: FolderNode[]
  placedBelow: number
  includedBelow: number
  unsureBelow: number
  heldBack: number
  documentIds: string[]
}

export interface PlacementSummary {
  sure: number
  unsure: number
  newFolders: number
  stays: number
  included: number
}

export interface PlacementTree {
  folders: FolderNode[]
  stays: FileNode[]
  summary: PlacementSummary
}

export interface KeptMoves {
  moves: KeptMove[]
}

type Destination = { folderId: string } | { newPath: string }

interface Resolved {
  documentId: string
  name: string
  destination: Destination | null
  heldPath: string | null
  reason: string
  confidence: number | null
  certainty: PlacementCertainty | null
  included: boolean
  chosenByPerson: boolean
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
}

export function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

function isSwitchedOff(excludedNewFolders: ReadonlySet<string>, path: string): boolean {
  for (const excluded of excludedNewFolders) if (isUnder(path, excluded)) return true
  return false
}

function resolveAll(input: PlacementInput, state: PlacementState): Resolved[] {
  const folderById = new Map(input.folders.map((folder) => [folder.id, folder]))
  const folderIdByPath = new Map(
    input.folders.map((folder) => [normalizePath(folder.path), folder.id])
  )
  const placementById = new Map<string, RootSortPlacement>()
  for (const placement of input.placements) {
    if (!placementById.has(placement.documentId)) placementById.set(placement.documentId, placement)
  }
  const proposalById = new Map<string, NewFolderProposal>()
  for (const proposal of input.newFolders) {
    for (const documentId of proposal.documentIds) {
      if (!proposalById.has(documentId)) proposalById.set(documentId, proposal)
    }
  }

  const destinationAt = (path: string): Destination => {
    const folderId = folderIdByPath.get(path)
    return folderId ? { folderId } : { newPath: path }
  }

  return input.documents.map((document): Resolved => {
    const placement = placementById.get(document.id)
    const proposal = proposalById.get(document.id)
    const placedPath = placement?.newFolderPath ? normalizePath(placement.newFolderPath) : ''
    const proposedPath = proposal ? normalizePath(proposal.path) : ''

    const base: { destination: Destination; reason: string; confidence: number | null } | null =
      placement?.folderId && folderById.has(placement.folderId)
        ? {
            destination: { folderId: placement.folderId },
            reason: placement.reason,
            confidence: placement.confidence,
          }
        : placement && placedPath
          ? {
              destination: destinationAt(placedPath),
              reason: placement.reason,
              confidence: placement.confidence,
            }
          : proposal && proposedPath
            ? {
                destination: destinationAt(proposedPath),
                reason: proposal.description ?? '',
                confidence: proposal.confidences[document.id] ?? null,
              }
            : null

    const retargeted = state.retargets.has(document.id)
    const chosen: Destination | null = retargeted
      ? (() => {
          const folderId = state.retargets.get(document.id) ?? null
          return folderId && folderById.has(folderId) ? { folderId } : null
        })()
      : (base?.destination ?? null)

    const switchedOff =
      chosen !== null &&
      'newPath' in chosen &&
      isSwitchedOff(state.excludedNewFolders, chosen.newPath)
    const destination = switchedOff ? null : chosen
    const certainty: PlacementCertainty | null = destination
      ? retargeted
        ? 'sure'
        : certaintyOf(base?.confidence ?? null)
      : null

    return {
      documentId: document.id,
      name: document.name,
      destination,
      heldPath: switchedOff && chosen && 'newPath' in chosen ? chosen.newPath : null,
      reason: retargeted ? '' : (base?.reason ?? ''),
      confidence: base?.confidence ?? null,
      certainty,
      included: destination !== null && !state.excluded.has(document.id),
      chosenByPerson: retargeted,
    }
  })
}

interface Draft {
  path: string
  folderId: string | null
  name: string
  isNew: boolean
  switchedOff: boolean
  parentPath: string | null
  files: FileNode[]
  children: Draft[]
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function nearestAncestor(path: string, drafts: ReadonlyMap<string, Draft>): string | null {
  const segments = path.split('/')
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const ancestor = segments.slice(0, length).join('/')
    if (drafts.has(ancestor)) return ancestor
  }
  return null
}

function buildDrafts(
  input: PlacementInput,
  resolved: readonly Resolved[],
  state: PlacementState
): Map<string, Draft> {
  const drafts = new Map<string, Draft>()
  const folderPathById = new Map(
    input.folders.map((folder) => [folder.id, normalizePath(folder.path)])
  )
  for (const folder of input.folders) {
    const path = normalizePath(folder.path)
    drafts.set(path, {
      path,
      folderId: folder.id,
      name: folder.name,
      isNew: false,
      switchedOff: false,
      parentPath: null,
      files: [],
      children: [],
    })
  }

  const newDraft = (path: string, switchedOff: boolean): void => {
    if (drafts.has(path)) return
    drafts.set(path, {
      path,
      folderId: null,
      name: lastSegment(path),
      isNew: true,
      switchedOff,
      parentPath: null,
      files: [],
      children: [],
    })
  }
  for (const row of resolved) {
    if (row.destination && 'newPath' in row.destination) newDraft(row.destination.newPath, false)
    if (row.heldPath) newDraft(row.heldPath, true)
  }
  for (const path of state.excludedNewFolders) {
    const held = resolved.some((row) => row.heldPath !== null && isUnder(row.heldPath, path))
    if (held) newDraft(normalizePath(path), true)
  }

  for (const draft of drafts.values()) {
    if (draft.isNew) {
      draft.parentPath = nearestAncestor(draft.path, drafts)
    } else {
      const folder = input.folders.find((candidate) => candidate.id === draft.folderId)
      const parent = folder?.parentId ? folderPathById.get(folder.parentId) : undefined
      draft.parentPath = parent && drafts.has(parent) ? parent : null
    }
  }
  for (const draft of drafts.values()) {
    if (draft.parentPath === null) continue
    drafts.get(draft.parentPath)?.children.push(draft)
  }

  for (const row of resolved) {
    if (!row.destination) continue
    const destination = row.destination
    const path =
      'newPath' in destination
        ? destination.newPath
        : normalizePath(
            input.folders.find((folder) => folder.id === destination.folderId)?.path ?? ''
          )
    drafts.get(path)?.files.push(toFileNode(row))
  }
  return drafts
}

function toFileNode(row: Resolved): FileNode {
  return {
    kind: 'file',
    id: row.documentId,
    name: row.name,
    reason: row.reason,
    confidence: row.confidence,
    certainty: row.certainty,
    included: row.included,
    chosenByPerson: row.chosenByPerson,
  }
}

interface Counts {
  placed: number
  included: number
  unsure: number
  held: number
  documentIds: string[]
}

function finish(
  draft: Draft,
  depth: number,
  drafts: ReadonlyMap<string, Draft>,
  held: readonly Resolved[]
): { node: FolderNode; counts: Counts } | null {
  const below = draft.children
    .map((child) => finish(child, depth + 1, drafts, held))
    .filter((entry): entry is { node: FolderNode; counts: Counts } => entry !== null)
  const ownHeld = held.filter(
    (row) => row.heldPath !== null && isUnder(row.heldPath, draft.path)
  ).length
  const counts: Counts = {
    placed: draft.files.length,
    included: draft.files.filter((file) => file.included).length,
    unsure: draft.files.filter((file) => file.certainty === 'unsure').length,
    held: ownHeld,
    documentIds: draft.files.map((file) => file.id),
  }
  for (const { counts: child } of below) {
    counts.placed += child.placed
    counts.included += child.included
    counts.unsure += child.unsure
    counts.documentIds.push(...child.documentIds)
  }
  if (counts.placed === 0 && counts.held === 0) return null
  const node: FolderNode = {
    kind: 'folder',
    path: draft.path,
    folderId: draft.folderId,
    name: draft.name,
    depth,
    isNew: draft.isNew,
    switchedOff: draft.switchedOff,
    files: [...draft.files].sort((a, b) => collator.compare(a.name, b.name)),
    children: below
      .map(({ node: child }) => child)
      .sort((a, b) => collator.compare(a.name, b.name)),
    placedBelow: counts.placed,
    includedBelow: counts.included,
    unsureBelow: counts.unsure,
    heldBack: counts.held,
    documentIds: counts.documentIds,
  }
  void drafts
  return { node, counts }
}

export function buildPlacementTree(input: PlacementInput, state: PlacementState): PlacementTree {
  const resolved = resolveAll(input, state)
  const drafts = buildDrafts(input, resolved, state)
  const held = resolved.filter((row) => row.heldPath !== null)
  const tops = [...drafts.values()].filter((draft) => draft.parentPath === null)
  const folders = tops
    .map((draft) => finish(draft, 1, drafts, held))
    .filter((entry): entry is { node: FolderNode; counts: Counts } => entry !== null)
    .map(({ node }) => node)
    .sort((a, b) => collator.compare(a.name, b.name))
  const stays = resolved
    .filter((row) => row.destination === null)
    .map(toFileNode)
    .sort((a, b) => collator.compare(a.name, b.name))

  const newFolders = countNewFolders(folders)
  const summary: PlacementSummary = {
    sure: resolved.filter((row) => row.destination && row.certainty === 'sure').length,
    unsure: resolved.filter((row) => row.destination && row.certainty === 'unsure').length,
    newFolders,
    stays: stays.length,
    included: resolved.filter((row) => row.included).length,
  }
  return { folders, stays, summary }
}

function countNewFolders(nodes: readonly FolderNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total +
      (node.isNew && !node.switchedOff && node.placedBelow > 0 ? 1 : 0) +
      countNewFolders(node.children),
    0
  )
}

export function keptMoves(input: PlacementInput, state: PlacementState): KeptMoves {
  const moves: KeptMove[] = []
  for (const row of resolveAll(input, state)) {
    if (!row.included || !row.destination) continue
    moves.push(
      'folderId' in row.destination
        ? { documentId: row.documentId, folderId: row.destination.folderId, newFolderPath: null }
        : { documentId: row.documentId, folderId: null, newFolderPath: row.destination.newPath }
    )
  }
  return { moves }
}

export function unsureOnly(tree: PlacementTree): PlacementTree {
  return {
    folders: tree.folders.flatMap(keepUnsure),
    stays: [],
    summary: tree.summary,
  }
}

function keepUnsure(node: FolderNode): FolderNode[] {
  if (node.unsureBelow === 0) return []
  return [
    {
      ...node,
      files: node.files.filter((file) => file.certainty === 'unsure'),
      children: node.children.flatMap(keepUnsure),
    },
  ]
}

export function folderKept(node: FolderNode): boolean | 'indeterminate' {
  if (node.switchedOff || node.includedBelow === 0) return false
  return node.includedBelow === node.placedBelow ? true : 'indeterminate'
}

export function setFileKept(
  state: PlacementState,
  documentId: string,
  kept: boolean
): PlacementState {
  const excluded = new Set(state.excluded)
  if (kept) excluded.delete(documentId)
  else excluded.add(documentId)
  return { ...state, excluded }
}

export function setFolderKept(
  state: PlacementState,
  node: FolderNode,
  kept: boolean
): PlacementState {
  if (node.isNew) {
    const excludedNewFolders = new Set(state.excludedNewFolders)
    if (kept) {
      for (const path of state.excludedNewFolders)
        if (isUnder(path, node.path)) excludedNewFolders.delete(path)
      const excluded = new Set(state.excluded)
      for (const id of node.documentIds) excluded.delete(id)
      return { ...state, excluded, excludedNewFolders }
    }
    excludedNewFolders.add(node.path)
    return { ...state, excludedNewFolders }
  }
  const excluded = new Set(state.excluded)
  for (const id of node.documentIds) {
    if (kept) excluded.delete(id)
    else excluded.add(id)
  }
  return { ...state, excluded }
}

export function retarget(
  state: PlacementState,
  documentId: string,
  choice: RetargetChoice
): PlacementState {
  const retargets = new Map(state.retargets)
  if (choice.kind === 'proposal') {
    retargets.delete(documentId)
    return { ...state, retargets }
  }
  retargets.set(documentId, choice.kind === 'folder' ? choice.folderId : null)
  const excluded = new Set(state.excluded)
  if (choice.kind === 'folder') excluded.delete(documentId)
  return { ...state, excluded, retargets }
}

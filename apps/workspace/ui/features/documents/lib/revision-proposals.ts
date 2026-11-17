import type { PlannedFile, PlannedRevision } from './folder-upload-plan'

export type ProposedFile = PlannedFile & { revisionOf: PlannedRevision }

export interface RevisionProposals {
  detected: ProposedFile[]
  unclear: ProposedFile[]
  master: 'all' | 'none' | 'some'
  ticked: number
}

const carriesProposal = (file: PlannedFile): file is ProposedFile => file.revisionOf !== undefined

function byFolderThenName(a: PlannedFile, b: PlannedFile): number {
  if (a.targetPath !== b.targetPath) return a.targetPath < b.targetPath ? -1 : 1
  const left = a.file.name
  const right = b.file.name
  return left < right ? -1 : left > right ? 1 : 0
}

export function groupRevisionProposals(files: readonly PlannedFile[]): RevisionProposals {
  const proposed = files.filter(carriesProposal)
  const detected = proposed.filter((file) => file.revisionOf.unambiguous).sort(byFolderThenName)
  const unclear = proposed.filter((file) => !file.revisionOf.unambiguous).sort(byFolderThenName)
  const ticked = detected.filter((file) => file.revisionOf.chosen).length
  return {
    detected,
    unclear,
    master: detected.length > 0 && ticked === detected.length ? 'all' : ticked === 0 ? 'none' : 'some',
    ticked,
  }
}

export interface FolderRun {
  folder: string
  files: ProposedFile[]
}

export function groupByFolder(files: readonly ProposedFile[]): FolderRun[] {
  const runs: FolderRun[] = []
  for (const file of files) {
    const last = runs.at(-1)
    if (last && last.folder === file.targetPath) last.files.push(file)
    else runs.push({ folder: file.targetPath, files: [file] })
  }
  return runs
}

export function countNewRevisions(files: readonly PlannedFile[], includeUpdates: boolean): number {
  return files.filter((file) => (file.action === 'update' ? includeUpdates : file.revisionOf?.chosen === true)).length
}

export function soleProposal(files: readonly PlannedFile[]): ProposedFile | null {
  const [only] = files
  return files.length === 1 && carriesProposal(only) ? only : null
}

export function masterTarget(master: RevisionProposals['master']): boolean {
  return master !== 'all'
}

export interface RevisionChange {
  files: readonly File[]
  chosen?: boolean
  targetId?: string
}

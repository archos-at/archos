import type { FileItem } from '../file-types'

export function isOlderRevision(file: FileItem, listedIds: ReadonlySet<string>): boolean {
  const newer = file.revision?.supersededBy
  return newer != null && listedIds.has(newer.id)
}

export function withoutOlderRevisions(files: readonly FileItem[], showOlder: boolean): readonly FileItem[] {
  if (showOlder) return files
  const ids = new Set(files.map((file) => file.id))
  return files.filter((file) => !isOlderRevision(file, ids))
}

export function revisionCount(file: FileItem): number {
  const facts = file.revision
  if (!facts) return 1
  const older = facts.history?.length ?? facts.supersedes.length
  return older + 1
}

import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem } from '../file-types'

function olderRevisionNames(file: FileItem): string[] {
  const facts = file.revision
  if (!facts) return []
  return (facts.history ?? facts.supersedes).map((ref) => ref.filename)
}

export function fileMatchesQuery(file: FileItem, q: string, tagText: (tag: string) => string): boolean {
  return (
    documentDisplayName(file).toLowerCase().includes(q) ||
    file.filename.toLowerCase().includes(q) ||
    (file.summary ?? '').toLowerCase().includes(q) ||
    (file.tags ?? []).some((tag) => tag.toLowerCase().includes(q) || tagText(tag).toLowerCase().includes(q)) ||
    (file.topics ?? []).some((topic) => topic.toLowerCase().includes(q)) ||
    olderRevisionNames(file).some((name) => name.toLowerCase().includes(q))
  )
}

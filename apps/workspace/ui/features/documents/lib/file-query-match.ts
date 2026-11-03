/**
 * Whether a document answers the file browser's typed query (`FileBrowserPane`):
 * its names, its summary, and the tags and topics the backend generated.
 */

import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem } from '../file-types'

/** The names a document's older Fassungen are stored under: what a search for them should find the document by. */
function olderRevisionNames(file: FileItem): string[] {
  const facts = file.revision
  if (!facts) return []
  return (facts.history ?? facts.supersedes).map((ref) => ref.filename)
}

/**
 * `q` is the trimmed, lower-cased query; `tagText` is what a person reads for a
 * tag, so a tag is found by its label („Korrespondenz“), not its stored token.
 *
 * Both names, deliberately: somebody who renamed a document looks for what they
 * called it, and somebody who uploaded it looks for the file they sent. The
 * older Fassungen's names count too: a document is found by any name it has
 * been stored under, and its current entry is the one that answers.
 */
export function fileMatchesQuery(file: FileItem, q: string, tagText: (tag: string) => string): boolean {
  return (
    documentDisplayName(file).toLowerCase().includes(q) ||
    file.filename.toLowerCase().includes(q) ||
    (file.summary ?? '').toLowerCase().includes(q) ||
    (file.tags ?? []).some((tag) => tagText(tag).toLowerCase().includes(q)) ||
    (file.topics ?? []).some((topic) => topic.toLowerCase().includes(q)) ||
    olderRevisionNames(file).some((name) => name.toLowerCase().includes(q))
  )
}

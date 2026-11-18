import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'

export const CLEANUP_CATEGORIES = [
  'temporary',
  'working_copy',
  'duplicate',
  'superseded',
  'unpublished_draft',
  'other',
] as const
export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number]

export interface CleanupDocumentFacts {
  id: string
  filename: string
  folderId: string | null
  folderPath: string | null
  contentType: string | null
  tags: readonly string[]
  summary: string | null
  versionState: DocumentVersionState | null
  authoredBy: 'user' | 'agent' | string
  contentHash: string | null
  createdAt: string
  screeningPassed: boolean
}

export interface RuleCandidate {
  id: string
  category: CleanupCategory
  rule: 'lock-file' | 'temp-file' | 'system-file' | 'copy-name' | 'old-name' | 'same-content' | 'older-version' | 'unpublished-draft'
}

const TEMPORARY: ReadonlyArray<[RegExp, RuleCandidate['rule']]> = [
  [/^~\$/, 'lock-file'],
  [/^\.~lock\..*#$/i, 'lock-file'],
  [/\.(tmp|bak|temp)$/i, 'temp-file'],
  [/~$/, 'temp-file'],
  [/^(thumbs\.db|\.ds_store|desktop\.ini)$/i, 'system-file'],
]

const COPY_NAMES = [/^(kopie von|copy of)\s/i, /\s-\s(kopie|copy)(\s\(\d+\))?\.[^.]+$/i, /\s\(\d+\)\.[^.]+$/]
const OLD_NAMES = /(^|[_\s.-])(alt|old|backup|sicherung)([_\s.-]|$)/i

function stemAndExtension(filename: string): [string, string] {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? [filename.slice(0, dot), filename.slice(dot + 1).toLowerCase()] : [filename, '']
}

export function versionOf(filename: string): { base: string; version: number } | null {
  const [stem] = stemAndExtension(filename)
  const numbered = /^(.*?)[\s_.-]*(?:v|ver|version|rev|r|stand)[\s_.-]?(\d{1,3})$/i.exec(stem)
  if (numbered && numbered[1].trim().length > 0) {
    return { base: numbered[1].trim().toLowerCase(), version: Number(numbered[2]) }
  }
  const lettered = /^(.*?)[\s_.-]*(?:index|idx)[\s_.-]?([a-z])$/i.exec(stem)
  if (lettered && lettered[1].trim().length > 0) {
    return { base: lettered[1].trim().toLowerCase(), version: lettered[2].toLowerCase().charCodeAt(0) - 96 }
  }
  return null
}

function byName(document: CleanupDocumentFacts): RuleCandidate | null {
  for (const [pattern, rule] of TEMPORARY) {
    if (pattern.test(document.filename)) return { id: document.id, category: 'temporary', rule }
  }
  if (COPY_NAMES.some((pattern) => pattern.test(document.filename))) {
    return { id: document.id, category: 'working_copy', rule: 'copy-name' }
  }
  if (OLD_NAMES.test(stemAndExtension(document.filename)[0])) {
    return { id: document.id, category: 'working_copy', rule: 'old-name' }
  }
  return null
}

function duplicates(documents: readonly CleanupDocumentFacts[]): Set<string> {
  const byHash = new Map<string, CleanupDocumentFacts[]>()
  for (const document of documents) {
    if (!document.contentHash) continue
    byHash.set(document.contentHash, [...(byHash.get(document.contentHash) ?? []), document])
  }
  const found = new Set<string>()
  for (const group of byHash.values()) {
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    for (const later of ordered.slice(1)) found.add(later.id)
  }
  return found
}

function olderVersions(documents: readonly CleanupDocumentFacts[]): Set<string> {
  const groups = new Map<string, Array<{ id: string; version: number }>>()
  for (const document of documents) {
    const parsed = versionOf(document.filename)
    if (!parsed) continue
    const key = `${document.folderId ?? ''}\u0000${parsed.base}\u0000${stemAndExtension(document.filename)[1]}`
    groups.set(key, [...(groups.get(key) ?? []), { id: document.id, version: parsed.version }])
  }
  const found = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const newest = Math.max(...group.map((entry) => entry.version))
    for (const entry of group) if (entry.version < newest) found.add(entry.id)
  }
  return found
}

export function ruleCandidates(documents: readonly CleanupDocumentFacts[]): RuleCandidate[] {
  const sameContent = duplicates(documents)
  const superseded = olderVersions(documents)
  const found: RuleCandidate[] = []
  for (const document of documents) {
    const named = byName(document)
    if (named) found.push(named)
    else if (sameContent.has(document.id)) found.push({ id: document.id, category: 'duplicate', rule: 'same-content' })
    else if (superseded.has(document.id)) found.push({ id: document.id, category: 'superseded', rule: 'older-version' })
    else if (document.authoredBy === 'agent' && document.versionState === 'draft') {
      found.push({ id: document.id, category: 'unpublished_draft', rule: 'unpublished-draft' })
    }
  }
  return found
}

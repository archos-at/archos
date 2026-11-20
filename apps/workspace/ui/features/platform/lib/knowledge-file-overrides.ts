import type { DocClass } from '@/lib/knowledge/doc-class'
import type { KnowledgeFile } from '@/lib/knowledge/service'

export function mergeKnowledgeFileOverrides(
  all: KnowledgeFile[],
  docClassOverrides: Record<string, DocClass>,
  displayTitleOverrides: Record<string, string>
): KnowledgeFile[] {
  if (Object.keys(docClassOverrides).length === 0 && Object.keys(displayTitleOverrides).length === 0) {
    return all
  }
  return all.map((f) => {
    let next = f
    if (docClassOverrides[f.fileName]) next = { ...next, docClass: docClassOverrides[f.fileName] }
    if (f.fileName in displayTitleOverrides) {
      next = { ...next, displayTitle: displayTitleOverrides[f.fileName] || null }
    }
    return next
  })
}

export function settleDocClassOverrides(
  prev: Record<string, DocClass>,
  files: KnowledgeFile[]
): Record<string, DocClass> {
  if (Object.keys(prev).length === 0) return prev
  const byName = new Map(files.map((f) => [f.fileName, f]))
  const remaining: Record<string, DocClass> = {}
  for (const [name, cls] of Object.entries(prev)) {
    if (byName.get(name)?.docClass !== cls) remaining[name] = cls
  }
  return remaining
}

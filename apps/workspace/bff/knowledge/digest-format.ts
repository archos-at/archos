export const DIGEST_BLOCK_MAX_CHARS = 900

export interface DigestLineItem {
  tags: string[]
  content: string
}

export function formatBoundedDigest(
  header: string,
  items: DigestLineItem[],
  maxChars: number
): string | null {
  return formatBoundedDigestWithKept(header, items, maxChars).digest
}

export function formatBoundedDigestWithKept<T extends DigestLineItem>(
  header: string,
  items: T[],
  maxChars: number
): { digest: string | null; kept: T[] } {
  if (items.length === 0) return { digest: null, kept: [] }

  const lines: string[] = [header]
  const kept: T[] = []
  let used = header.length
  for (const item of items) {
    const content = item.content.replace(/\s+/g, ' ').trim()
    if (!content) continue
    const escaped = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const line = `- [${item.tags.join(' | ')}] "${escaped}"`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    kept.push(item)
    used += line.length + 1
  }

  return lines.length > 1 ? { digest: lines.join('\n'), kept } : { digest: null, kept: [] }
}

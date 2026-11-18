import { isDelimiterRow } from '@/lib/text/markdown-table'

export function isOpenFence(lines: readonly string[], start: number, end: number): boolean {
  const last = lines.length
  if (end < last) return false
  const opener = lines[start - 1]?.match(/(`{3,}|~{3,})/)?.[1]
  if (!opener || end <= start) return true
  const closer = lines[end - 1]?.match(/^[\s>]*(`{3,}|~{3,})\s*$/)?.[1]
  return !(closer && closer[0] === opener[0] && closer.length >= opener.length)
}

export function stabilizeStreamingMarkdown(raw: string): string {
  let content = raw

  const lines = content.split('\n')
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  let start = end
  while (start > 0 && lines[start - 1].trim().startsWith('|')) start--
  if (end - start >= 1) {
    const tableLines = lines.slice(start, end)
    const hasDelimiterRow = tableLines.some(isDelimiterRow)
    if (!hasDelimiterRow) {
      for (let i = start; i < end; i++) {
        lines[i] = lines[i].replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
      }
      content = lines.join('\n')
    }
  }

  return closeOpenBold(holdHalfDirective(content))
}

export function holdHalfDirective(content: string): string {
  const cut = content.lastIndexOf('\n') + 1
  const line = content.slice(cut)
  const fences = content.match(/^[ \t]*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return content
  if (/^\s*:{2,}$/.test(line)) return openContainers(content.slice(0, cut)) > 0 && /:{3}/.test(line) ? content : content.slice(0, cut)
  if (/^\s*:{3,}[A-Za-z][\w-]*\[[^\]]*$/.test(line)) return content.slice(0, cut)
  if (/^\s*:{3,}[A-Za-z][\w-]*(?:\[[^\]]*\])?\{[^}]*$/.test(line)) return content.slice(0, cut)
  const from = line.lastIndexOf(']') + 1
  const inline = /(^|[^\w:]):[A-Za-z][\w-]{0,63}\[[^\]]*$/.exec(line.slice(from))
  return inline ? content.slice(0, cut + from + inline.index + inline[1].length) : content
}

function openContainers(content: string): number {
  let open = 0
  for (const line of content.split('\n')) {
    if (/^\s*:{3,}[A-Za-z]/.test(line)) open += 1
    else if (/^\s*:{3,}\s*$/.test(line) && open > 0) open -= 1
  }
  return open
}

function closeOpenBold(content: string): string {
  const fences = content.match(/^[ \t]*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return content
  const line = content.slice(content.lastIndexOf('\n') + 1)
  if (line.trimStart().startsWith('|')) return content
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return content
  if ((line.match(/\*\*/g)?.length ?? 0) % 2 === 0) return content
  const trimmed = content.trimEnd()
  if (trimmed.endsWith('**')) return content
  return `${trimmed}**`
}

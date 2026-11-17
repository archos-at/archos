const ELLIPSIS = '…'

export function excerptAround(text: string, term: string | null, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const at = term
    ? flat.toLocaleLowerCase().indexOf(term.trim().replace(/\s+/g, ' ').toLocaleLowerCase())
    : -1
  if (at < 0) return `${flat.slice(0, max - 1).trimEnd()}${ELLIPSIS}`
  const room = max - 2
  const start = Math.max(0, Math.min(at - Math.floor(room / 3), flat.length - room))
  const end = Math.min(flat.length, start + room)
  const head = start > 0 ? ELLIPSIS : ''
  const tail = end < flat.length ? ELLIPSIS : ''
  return `${head}${flat.slice(start, end).trim()}${tail}`
}

const CARD_MARKER_LINE = /^ {0,3}\[\[(?:card:\d+|callout)\]\][ \t]*$/
const CARD_MARKER = /\[\[(?:card:\d+|callout)\]\]/g

export const stripCardMarkers = (markdown: string): string => {
  const lines: string[] = []
  for (const line of markdown.split('\n')) {
    if (CARD_MARKER_LINE.test(line)) continue
    const stripped = CARD_MARKER.test(line) ? line.replace(CARD_MARKER, '').trimEnd() : line
    if (stripped.trim() === '' && lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
      continue
    }
    lines.push(stripped)
  }
  return lines.join('\n').trim()
}

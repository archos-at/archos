const NAME_SUGGESTION_MAX = 60

export function suggestName(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= NAME_SUGGESTION_MAX) return firstLine
  const clipped = firstLine.slice(0, NAME_SUGGESTION_MAX)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

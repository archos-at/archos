export function isDelimiterRow(line: string): boolean {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!inner.includes('-')) return false
  return inner.split('|').every((cell) => /^\s*:?-+:?\s*$/.test(cell))
}

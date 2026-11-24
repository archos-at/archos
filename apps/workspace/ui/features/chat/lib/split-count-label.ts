export const splitCount = (text: string): { before: string; count: string; after: string } | null => {
  const match = /\d+(?:[.,\u00a0\u202f]\d{3})*/.exec(text)
  if (!match) return null
  return {
    before: text.slice(0, match.index),
    count: match[0],
    after: text.slice(match.index + match[0].length),
  }
}

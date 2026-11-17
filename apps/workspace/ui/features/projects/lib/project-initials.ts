const WORD = /[\p{L}\p{N}]+/gu

export function projectInitials(name: string): string {
  const words = name.match(WORD)
  if (!words || words.length === 0) return '·'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

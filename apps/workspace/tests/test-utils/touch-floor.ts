export type TouchAxes = { height: boolean; width: boolean }

const FLOOR_UNITS = 11
const SIZING = /^(size|h|min-h|w|min-w)-(\d+(?:\.\d+)?)$/

const variantsAndUtility = (token: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index++) {
    const char = token[index]
    if (char === '[' || char === '(') depth++
    else if (char === ']' || char === ')') depth--
    else if (char === ':' && depth === 0) {
      parts.push(token.slice(start, index))
      start = index + 1
    }
  }
  parts.push(token.slice(start))
  return parts
}

export const coarseFloorAxes = (classes: Iterable<string>): TouchAxes => {
  const axes: TouchAxes = { height: false, width: false }
  for (const token of classes) {
    const variants = variantsAndUtility(token)
    const utility = (variants.pop() ?? '').replace(/^!|!$/g, '')
    const match = SIZING.exec(utility)
    if (!variants.includes('pointer-coarse') || !match || Number(match[2]) < FLOOR_UNITS) continue
    if (match[1] !== 'w' && match[1] !== 'min-w') axes.height = true
    if (match[1] !== 'h' && match[1] !== 'min-h') axes.width = true
  }
  return axes
}

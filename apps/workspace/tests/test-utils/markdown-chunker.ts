const PY_SPACE = String.raw`[\s\x1c-\x1f\x85]`
const ATX_HEADING = new RegExp(`^#{1,6}${PY_SPACE}+.+?${PY_SPACE}*#*${PY_SPACE}*$`)
const FENCE = new RegExp(`^${PY_SPACE}*(\`\`\`|~~~)`)

export function pythonSplitlines(value: string): string[] {
  const lines = value.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

export function chunkerReads(markdown: string): { headings: string[]; fences: number } {
  const lines = pythonSplitlines(markdown)
  return {
    headings: lines.filter((line) => ATX_HEADING.test(line)),
    fences: lines.filter((line) => FENCE.test(line)).length,
  }
}

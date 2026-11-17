export interface CodeFence {
  char: string
  length: number
}

export interface CodeFenceOptions {
  math?: boolean
  maxIndent?: number
}

const OPENER = /^([ \t]*)(`{3,}|~{3,}|\${2,})(.*)$/
const CLOSER = /^([ \t]*)(`{3,}|~{3,}|\${2,})[ \t]*$/

const indentOk = (indent: string, maxIndent: number | undefined): boolean =>
  maxIndent === undefined || indent.length <= maxIndent

export function openingCodeFence(line: string, options: CodeFenceOptions = {}): CodeFence | null {
  const match = OPENER.exec(line)
  if (!match || !indentOk(match[1], options.maxIndent)) return null
  const marker = match[2]
  const char = marker[0]
  if (char === '$' && !options.math) return null
  if (char !== '~' && match[3].includes(char)) return null
  return { char, length: marker.length }
}

export function closesCodeFence(line: string, fence: CodeFence, options: CodeFenceOptions = {}): boolean {
  const match = CLOSER.exec(line)
  return (
    match !== null && indentOk(match[1], options.maxIndent) && match[2][0] === fence.char && match[2].length >= fence.length
  )
}

export function fencedBlock(text: string, info = 'text'): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${info}\n${text}\n${fence}`
}

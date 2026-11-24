export const PREVIEW_LINES = 6
export const PREVIEW_CHARS = 600

export interface TextPreview {
  head: string
  more: boolean
}

export function tidyText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function textPreview(text: string, lines = PREVIEW_LINES, chars = PREVIEW_CHARS): TextPreview {
  const tidy = tidyText(text)
  const all = tidy.split('\n')
  let head = all.length <= lines ? tidy : all.slice(0, lines).join('\n').trimEnd()
  if (head.length > chars) {
    const cut = head.lastIndexOf(' ', chars)
    head = `${head.slice(0, cut > chars / 2 ? cut : chars).trimEnd()} …`
  }
  return { head, more: head !== tidy }
}

export const SUBSTANTIVE_TEXT_WORDS = 6

export function substantiveText(text: string): boolean {
  const words = tidyText(text).replace(URL_PATTERN, ' ').split(/\s+/u).filter((word) => /\p{L}{2,}/u.test(word))
  return words.length >= SUBSTANTIVE_TEXT_WORDS
}

export function linkDomain(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/giu

export function textRuns(text: string): Array<{ kind: 'text'; value: string } | { kind: 'link'; value: string; domain: string }> {
  const runs: Array<{ kind: 'text'; value: string } | { kind: 'link'; value: string; domain: string }> = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const domain = linkDomain(match[0])
    if (!domain) continue
    if (start > last) runs.push({ kind: 'text', value: text.slice(last, start) })
    runs.push({ kind: 'link', value: match[0], domain })
    last = start + match[0].length
  }
  if (last < text.length) runs.push({ kind: 'text', value: text.slice(last) })
  return runs
}

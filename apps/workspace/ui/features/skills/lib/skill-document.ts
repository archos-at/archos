export interface SkillDocumentInput {
  name: string
  description: string
  body: string
  metadata?: Record<string, string>
}

export interface SkillDocumentParts {
  frontmatter: string
  body: string
}

function yamlScalar(value: string): string {
  const needsQuotes =
    value === '' ||
    /^[\s]|[\s]$/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[-+]?\d+(\.\d+)?$/.test(value) ||
    /[:#{}[\],&*?|<>=!%@`"']/.test(value) ||
    value.includes('\n')
  if (!needsQuotes) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function foldedScalar(value: string, indent = '  ', width = 88): string {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return `>-\n${lines.map((entry) => `${indent}${entry}`).join('\n')}`
}

const INLINE_DESCRIPTION_MAX = 72

export function renderSkillDocumentParts({
  name,
  description,
  body,
  metadata = {},
}: SkillDocumentInput): SkillDocumentParts {
  const lines: string[] = ['---']
  lines.push(`name: ${yamlScalar(name)}`)

  const trimmedDescription = description.trim()
  lines.push(
    trimmedDescription.length > INLINE_DESCRIPTION_MAX
      ? `description: ${foldedScalar(trimmedDescription)}`
      : `description: ${yamlScalar(trimmedDescription)}`,
  )

  const keys = Object.keys(metadata).sort()
  if (keys.length > 0) {
    lines.push('metadata:')
    for (const key of keys) {
      lines.push(`  ${key}: ${yamlScalar(metadata[key])}`)
    }
  }

  lines.push('---')

  return { frontmatter: lines.join('\n'), body: body.trim() }
}

export function renderSkillDocument(input: SkillDocumentInput): string {
  const { frontmatter, body } = renderSkillDocumentParts(input)
  return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`
}

export type SkillDocumentParseError =
  | 'missing-frontmatter'
  | 'unterminated-frontmatter'
  | 'malformed-frontmatter'
  | 'missing-name'
  | 'missing-description'

export interface ParsedSkillDocument {
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  ignoredKeys: string[]
}

export type SkillDocumentParseResult =
  | { ok: true; value: ParsedSkillDocument }
  | { ok: false; error: SkillDocumentParseError }

const KNOWN_KEYS = new Set(['name', 'description', 'metadata'])

const KEY_LINE = /^([A-Za-z0-9][A-Za-z0-9_.-]*):[ \t]?(.*)$/
const NESTED_KEY_LINE = /^[ \t]+([A-Za-z0-9][A-Za-z0-9_.-]*):[ \t]?(.*)$/

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function isBlockContinuation(line: string): boolean {
  return line.trim() === '' || /^[ \t]/.test(line)
}

function readBlockScalar(
  lines: string[],
  start: number,
  folded: boolean,
): { value: string; next: number } {
  const collected: string[] = []
  let index = start
  while (index < lines.length && isBlockContinuation(lines[index])) {
    collected.push(lines[index].trim())
    index += 1
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
  return { value: folded ? collected.join(' ').trim() : collected.join('\n'), next: index }
}

export function parseSkillDocument(raw: string): SkillDocumentParseResult {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)

  let cursor = 0
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1
  if (cursor >= lines.length || lines[cursor].trim() !== '---') {
    return { ok: false, error: 'missing-frontmatter' }
  }
  cursor += 1

  const open = cursor
  let close = -1
  for (let index = open; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      close = index
      break
    }
  }
  if (close === -1) return { ok: false, error: 'unterminated-frontmatter' }

  const frontmatter = lines.slice(open, close)
  const scalars: Record<string, string> = {}
  const metadata: Record<string, string> = {}
  const ignoredKeys: string[] = []

  let index = 0
  while (index < frontmatter.length) {
    const line = frontmatter[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      index += 1
      continue
    }
    const match = KEY_LINE.exec(line)
    if (!match) return { ok: false, error: 'malformed-frontmatter' }

    const [, key, rest] = match
    index += 1

    if (key === 'metadata' && rest.trim() === '') {
      while (index < frontmatter.length) {
        const nested = frontmatter[index]
        if (nested.trim() === '') {
          index += 1
          continue
        }
        const nestedMatch = NESTED_KEY_LINE.exec(nested)
        if (!nestedMatch) break
        metadata[nestedMatch[1]] = unquote(nestedMatch[2])
        index += 1
      }
      continue
    }

    let value: string
    const indicator = rest.trim()
    if (indicator.startsWith('>') || indicator.startsWith('|')) {
      const block = readBlockScalar(frontmatter, index, indicator.startsWith('>'))
      value = block.value
      index = block.next
    } else {
      value = unquote(rest)
    }

    if (KNOWN_KEYS.has(key)) scalars[key] = value
    else if (!ignoredKeys.includes(key)) ignoredKeys.push(key)
  }

  const name = (scalars.name ?? '').trim()
  const description = (scalars.description ?? '').trim()
  if (!name) return { ok: false, error: 'missing-name' }
  if (!description) return { ok: false, error: 'missing-description' }

  return {
    ok: true,
    value: {
      name,
      description,
      body: lines.slice(close + 1).join('\n').trim(),
      metadata,
      ignoredKeys,
    },
  }
}

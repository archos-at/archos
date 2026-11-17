export type TranslationVars = Record<string, string | number>

export type Translator = (key: string, vars?: TranslationVars) => string

export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

const HAS_PLURAL_RE = /,\s*plural\s*,/

const PLURAL_HEADER_RE = /^\{(\w+),\s*plural,\s*/

const PLURAL_BRANCH_RE = /^\s*(\w+)\s*\{/

function closingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function parseBranches(body: string): Record<string, string> {
  const branches: Record<string, string> = {}
  let cursor = 0
  while (cursor < body.length) {
    const label = PLURAL_BRANCH_RE.exec(body.slice(cursor))
    if (!label) break
    const open = cursor + label[0].length - 1
    const close = closingBrace(body, open)
    if (close === -1) break
    branches[label[1]] = body.slice(open + 1, close)
    cursor = close + 1
  }
  return branches
}

function applyPlurals(template: string, vars: TranslationVars): string {
  let out = ''
  let cursor = 0

  while (cursor < template.length) {
    const start = template.indexOf('{', cursor)
    if (start === -1) {
      out += template.slice(cursor)
      return out
    }

    const header = PLURAL_HEADER_RE.exec(template.slice(start))
    const close = header ? closingBrace(template, start) : -1
    if (!header || close === -1) {
      out += template.slice(cursor, start + 1)
      cursor = start + 1
      continue
    }

    const branches = parseBranches(template.slice(start + header[0].length, close))
    const value = vars[header[1]]
    const count = typeof value === 'number' ? value : Number(value)
    const chosen =
      Number.isFinite(count) && count === 1 && branches.one !== undefined
        ? branches.one
        : (branches.other ?? '')

    out += template.slice(cursor, start) + chosen.split('#').join(String(value ?? ''))
    cursor = close + 1
  }

  return out
}

export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  const resolved = HAS_PLURAL_RE.test(template) ? applyPlurals(template, vars) : template
  return resolved.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export function createTranslator(dictionary: unknown, namespace?: string): Translator {
  return (key, vars) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    const value = getByPath(dictionary, fullKey)

    if (typeof value === 'string') {
      return interpolate(value, vars)
    }

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] Missing translation for key: "${fullKey}"`)
    }
    return fullKey
  }
}

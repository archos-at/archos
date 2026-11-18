import { CITATION_KEY_QUALIFIERS, scopeForQualifier, type Shelf } from '@/lib/source-kinds'
import { stripOriginToken } from './model'

export interface KbCitationLocator {
  filename: string
  page?: number
  shelf?: Shelf
}

const PAGE_REF_RE = /[,\s]\s*(?:p\.?|page)\s*(\d+)(?=\s*(?:[,)\]]|$))/i

const FILENAME_RE = /^.+\.\w{2,5}$/

const SCOPE_QUALIFIER_RE = new RegExp(
  `\\s*\\((${CITATION_KEY_QUALIFIERS.map(([label]) =>
    label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|')})\\)\\s*$`,
  'i'
)

const PSEUDO_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

export const parseKbLocator = (text: string): KbCitationLocator | null => {
  const line = stripOriginToken(text).split('\n')[0]?.trim() ?? ''
  if (!line) return null
  const pageMatch = PAGE_REF_RE.exec(line)
  const page = pageMatch ? Number(pageMatch[1]) : undefined
  let filename = (pageMatch ? line.slice(0, pageMatch.index) : line).replace(/[\s,]+$/, '').trim()
  const qualifierMatch = SCOPE_QUALIFIER_RE.exec(filename)
  const shelf = qualifierMatch ? scopeForQualifier(qualifierMatch[1]) : undefined
  if (qualifierMatch) {
    filename = filename.slice(0, qualifierMatch.index).replace(/[\s,]+$/, '').trim()
  }
  if (!FILENAME_RE.test(filename)) return null
  return { filename, page, shelf }
}

export const locatorFromPseudoUrl = (url: string): KbCitationLocator | null => {
  const basename = url.replace(PSEUDO_SCHEME_RE, '').split('/').pop() ?? ''
  try {
    return parseKbLocator(decodeURIComponent(basename))
  } catch {
    return parseKbLocator(basename)
  }
}

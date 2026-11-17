const DOC_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'markdown',
  'xls', 'xlsx', 'ods', 'csv', 'tsv',
  'ppt', 'pptx', 'odp',
  'html', 'htm', 'xml', 'json', 'eml', 'msg',
  'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff',
  'dwg', 'dxf', 'ifc', 'zip',
])

const OIB_ROLE_PREFIXES: Array<[string, string]> = [
  ['erlaeuterungen_', 'Erläuterungen zu '],
  ['aenderungen_', 'Änderungen zu '],
]

const OIB_EDITION_RE = /ausgabe[_-]mai[_-]2023/
const OIB_REVISION_RE = /rev[_.]?(\d+)/
const OIB_NUMBER_RE = /^(\d+(?:\.\d+)?)/

const OIB_PUBLISHED_STEM_RE = /^(?:(erlaeuterungen|aenderungen)(?:_|-zu-))?oib-(?:rl|richtlinie)_/

export function canonicalOibFileName(fileName: string): string {
  const low = fileName.toLowerCase()
  const match = OIB_PUBLISHED_STEM_RE.exec(low)
  if (!match) return low
  const role = match[1] ? `${match[1]}_` : ''
  return `${role}oib-rl_${low.slice(match[0].length)}`
}

const baseName = (name: string): string => name.split(/[/\\]/).pop() || name

const splitExtension = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return [name, '']
  return [name.slice(0, dot), name.slice(dot + 1).toLowerCase()]
}

const stripUnderscores = (value: string): string => value.replace(/^_+|_+$/g, '')

export function oibDisplayTitle(fileName: string): string | null {
  if (!fileName?.trim()) return null
  const [stem] = splitExtension(baseName(fileName.trim()))
  let low = canonicalOibFileName(stem).replace('-leitfaden', '_leitfaden')

  let rolePrefix = ''
  for (const [marker, german] of OIB_ROLE_PREFIXES) {
    if (low.startsWith(marker)) {
      rolePrefix = german
      low = low.slice(marker.length)
      break
    }
  }

  if (!low.startsWith('oib-rl_')) return null
  low = low.slice('oib-rl_'.length)

  let edition = ''
  const editionMatch = OIB_EDITION_RE.exec(low)
  if (editionMatch) {
    edition = 'Ausgabe Mai 2023'
    low = stripUnderscores(low.slice(0, editionMatch.index) + low.slice(editionMatch.index + editionMatch[0].length))
  }

  let revision = ''
  const revisionMatch = OIB_REVISION_RE.exec(low)
  if (revisionMatch) {
    revision = `Rev. ${revisionMatch[1]}`
    low = stripUnderscores(low.slice(0, revisionMatch.index) + low.slice(revisionMatch.index + revisionMatch[0].length))
  }

  const isGuide = low.includes('leitfaden')
  low = stripUnderscores(low.replace('leitfaden', ''))

  let subject: string
  if (low.startsWith('begriffsbestimmungen')) {
    subject = 'OIB-Richtlinie Begriffsbestimmungen'
  } else if (low.startsWith('zitierte_normen')) {
    subject = 'OIB-Richtlinie – Zitierte Normen und sonstige technische Regelwerke'
  } else if (!low) {
    subject = 'OIB-Richtlinie'
  } else {
    const numberMatch = OIB_NUMBER_RE.exec(low)
    if (!numberMatch) return null
    subject = `OIB-Richtlinie ${numberMatch[1]}`
  }
  if (isGuide) subject += ' – Leitfaden'

  const title = `${rolePrefix}${subject}`
  const tail = [edition, revision].filter(Boolean).join(', ')
  return tail ? `${title}, ${tail}` : title
}

function humanizeFileName(fileName: string): string {
  const [stem, ext] = splitExtension(baseName(fileName.trim()))
  const body = ext && DOC_EXTENSIONS.has(ext) ? stem : `${stem}${ext ? `.${ext}` : ''}`
  const spaced = body
    .replace(/[_]+/g, ' ')
    .replace(/%20/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return fileName.trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function documentDisplayName(name: string, title?: string | null): string {
  const wire = title?.trim()
  if (wire) return wire
  const raw = name?.trim()
  if (!raw) return ''
  return oibDisplayTitle(raw) ?? humanizeFileName(raw)
}

export function documentShortName(name: string, title?: string | null): string {
  const full = documentDisplayName(name, title)
  const trimmed = full.replace(/,\s*(Ausgabe\s+[^,]+|Rev\.\s*[\d.]+)(?=,|$)/g, '')
  const cleaned = trimmed.replace(/,\s*$/, '').trim()
  return bindAbbreviations(cleaned || full)
}

export const bindAbbreviations = (text: string): string => text.replace(/\bOIB-RL\b/g, 'OIB\u2011RL')

export function documentEdition(name: string, title?: string | null): string | undefined {
  const full = documentDisplayName(name, title)
  const tails = [...full.matchAll(/,\s*(Ausgabe\s+[^,]+|Rev\.\s*[\d.]+)(?=,|$)/g)].map((match) => match[1].trim())
  return tails.length > 0 ? tails.join(', ') : undefined
}

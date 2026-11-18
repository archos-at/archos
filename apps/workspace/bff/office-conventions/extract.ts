import { folderMatchKey } from '@/lib/projects/folders'

export const EXTRACTOR_VERSION = 3

export const MIN_PROJECTS = 3

export const MIN_SHARE = 0.5

export const MAX_SKELETON_FOLDERS = 12

export const MAX_SKELETON_DEPTH = 2

export interface ConventionDocument {
  projectId: string
  folderPath: string
  filename: string
  docType: string | null
  documentNumber: string | null
  revision: string | null
  uploadedAt?: Date | null
}

export interface ConventionMove {
  projectId: string
  docType: string
  folderPath: string
}

export interface ConventionFolder {
  projectId: string
  path: string
}

export interface Support {
  projects: number
  of: number
}

export type RevisionStyle = 'letter' | 'number' | 'padded_number' | 'letter_number'

export interface OfficeConventions {
  version: typeof EXTRACTOR_VERSION
  projects: number
  folders: Array<{ path: string } & Support>
  filing: Array<{ docType: string; path: string } & Support>
  documentNumber: ({ shape: string } & Support) | null
  revisionStyle: ({ style: RevisionStyle } & Support) | null
  fileDate: ({ format: string } & Support) | null
}

const ORDINAL_PREFIX = /^\d{1,3}\s*[._-]?\s+|^\d{1,3}[._-]\s*/

export function conventionPathKey(path: string): string {
  return path
    .split('/')
    .map((segment) => folderMatchKey(segment.trim().replace(ORDINAL_PREFIX, '')))
    .filter((segment) => segment.length > 0)
    .join('/')
}

function modal(values: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value
      bestCount = count
    }
  }
  return best
}

function perProject<T>(items: readonly T[], projectOf: (item: T) => string, valueOf: (item: T) => string | null) {
  const grouped = new Map<string, string[]>()
  for (const item of items) {
    const value = valueOf(item)
    if (value === null) continue
    const list = grouped.get(projectOf(item)) ?? []
    list.push(value)
    grouped.set(projectOf(item), list)
  }
  return grouped
}

export function isPattern(support: Support): boolean {
  return support.of > 0 && support.projects >= MIN_PROJECTS && support.projects / support.of >= MIN_SHARE
}

function agreedAcrossProjects(grouped: ReadonlyMap<string, string[]>): ({ value: string } & Support) | null {
  const modes = [...grouped.values()].map(modal).filter((value): value is string => value !== null)
  const value = modal(modes)
  if (value === null) return null
  const support = { projects: modes.filter((mode) => mode === value).length, of: modes.length }
  return isPattern(support) ? { value, ...support } : null
}

function spellings(paths: Iterable<[key: string, spelling: string]>): Map<string, string> {
  const seen = new Map<string, string[]>()
  for (const [key, spelling] of paths) seen.set(key, [...(seen.get(key) ?? []), spelling])
  return new Map([...seen].map(([key, list]) => [key, modal(list) ?? key]))
}

function prefixes(path: string): string[] {
  const segments = path.split('/').map((segment) => segment.trim()).filter(Boolean)
  return segments.slice(0, MAX_SKELETON_DEPTH).map((_, index) => segments.slice(0, index + 1).join('/'))
}

function learnSkeleton(folders: readonly ConventionFolder[], projectsWithFolders: number) {
  const projectsByKey = new Map<string, Set<string>>()
  const seen: Array<[string, string]> = []
  for (const folder of folders) {
    for (const prefix of prefixes(folder.path)) {
      const key = conventionPathKey(prefix)
      if (!key) continue
      projectsByKey.set(key, (projectsByKey.get(key) ?? new Set()).add(folder.projectId))
      seen.push([key, prefix])
    }
  }
  const spelled = spellings(seen)
  return [...projectsByKey]
    .map(([key, projects]) => ({ path: spelled.get(key) ?? key, projects: projects.size, of: projectsWithFolders }))
    .filter(isPattern)
    .sort((a, b) => b.projects - a.projects || a.path.localeCompare(b.path))
    .slice(0, MAX_SKELETON_FOLDERS)
}

const filedIn = (doc: ConventionDocument): string => prefixes(doc.folderPath).at(-1) ?? ''

function learnFiling(documents: readonly ConventionDocument[], moves: readonly ConventionMove[]) {
  const filed = documents.filter((doc) => doc.docType !== null && conventionPathKey(filedIn(doc)) !== '')
  const moved = moves.filter((move) => conventionPathKey(prefixes(move.folderPath).at(-1) ?? '') !== '')
  const movedIn = (move: ConventionMove): string => prefixes(move.folderPath).at(-1) ?? ''
  const spelled = spellings([
    ...filed.map((doc): [string, string] => [conventionPathKey(filedIn(doc)), filedIn(doc)]),
    ...moved.map((move): [string, string] => [conventionPathKey(movedIn(move)), movedIn(move)]),
  ])
  const types = [...new Set([...filed.map((doc) => doc.docType as string), ...moved.map((move) => move.docType)])].sort()
  return types.flatMap((docType) => {
    const ofType = filed.filter((doc) => doc.docType === docType)
    const votes = perProject(ofType, (doc) => doc.projectId, (doc) => conventionPathKey(filedIn(doc)))
    const chosen = moved.filter((move) => move.docType === docType)
    for (const projectId of new Set(chosen.map((move) => move.projectId))) {
      votes.set(
        projectId,
        chosen.filter((move) => move.projectId === projectId).map((move) => conventionPathKey(movedIn(move)))
      )
    }
    const agreed = agreedAcrossProjects(votes)
    if (!agreed) return []
    return [{ docType, path: spelled.get(agreed.value) ?? agreed.value, projects: agreed.projects, of: agreed.of }]
  })
}

export function documentNumberShape(value: string): string | null {
  const trimmed = value.trim().toUpperCase()
  if (trimmed.length < 3 || !/\d/.test(trimmed)) return null
  return trimmed.replace(/\p{L}+/gu, 'A').replace(/\d/g, '0').replace(/\s+/g, ' ')
}

export function revisionStyleOf(value: string): RevisionStyle | null {
  const bare = value.trim().replace(/^(index|idx|rev(ision)?)\.?\s*[:-]?\s*/i, '')
  if (/^\p{L}$/u.test(bare)) return 'letter'
  if (/^0\d$/.test(bare)) return 'padded_number'
  if (/^\d{1,3}$/.test(bare)) return 'number'
  if (/^\p{L}\d{1,2}$/u.test(bare)) return 'letter_number'
  return null
}

const validDay = (month: number, day: number): boolean => month >= 1 && month <= 12 && day >= 1 && day <= 31

const DATE_BEFORE_UPLOAD_MS = 3 * 365 * 24 * 3600 * 1000
const DATE_AFTER_UPLOAD_MS = 31 * 24 * 3600 * 1000

function nearUpload(year: number, month: number, day: number, uploadedAt: Date): boolean {
  if (!validDay(month, day)) return false
  const gap = uploadedAt.getTime() - Date.UTC(year, month - 1, day)
  return gap <= DATE_BEFORE_UPLOAD_MS && gap >= -DATE_AFTER_UPLOAD_MS
}

function sixDigitFormat(name: string, uploadedAt: Date | null | undefined): string | null {
  const six = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/.exec(name)
  if (!six || !uploadedAt) return null
  const [first, month, last] = [Number(six[1]), Number(six[2]), Number(six[3])]
  const asYymmdd = nearUpload(2000 + first, month, last, uploadedAt)
  const asDdmmyy = nearUpload(2000 + last, month, first, uploadedAt)
  if (asYymmdd === asDdmmyy) return null
  return asYymmdd ? 'YYMMDD' : 'DDMMYY'
}

export function fileDateFormatOf(filename: string, uploadedAt?: Date | null): string | null {
  const name = filename.replace(/\.[^.]+$/, '')
  const iso = /(?<!\d)(?:19|20)\d{2}([-_.])(\d{2})\1(\d{2})(?!\d)/.exec(name)
  if (iso && validDay(Number(iso[2]), Number(iso[3]))) return `YYYY${iso[1]}MM${iso[1]}DD`
  const european = /(?<!\d)(\d{2})([._-])(\d{2})\2((?:19|20)\d{2})(?!\d)|(?<!\d)(\d{2})\.(\d{2})\.(\d{2})(?!\d)/.exec(name)
  if (european) {
    const [day, month] = european[1] ? [european[1], european[3]] : [european[5], european[6]]
    const separator = european[2] ?? '.'
    if (validDay(Number(month), Number(day))) return `DD${separator}MM${separator}${european[4] ? 'YYYY' : 'YY'}`
  }
  const compact = /(?<!\d)(?:19|20)\d{2}(\d{2})(\d{2})(?!\d)/.exec(name)
  if (compact && validDay(Number(compact[1]), Number(compact[2]))) return 'YYYYMMDD'
  return sixDigitFormat(name, uploadedAt)
}

function learnPattern<T extends string>(
  documents: readonly ConventionDocument[],
  read: (doc: ConventionDocument) => T | null
): ({ value: T } & Support) | null {
  const agreed = agreedAcrossProjects(perProject(documents, (doc) => doc.projectId, read))
  return agreed as ({ value: T } & Support) | null
}

export function extractOfficeConventions(input: {
  documents: readonly ConventionDocument[]
  folders: readonly ConventionFolder[]
  moves?: readonly ConventionMove[]
}): OfficeConventions {
  const { documents, folders, moves = [] } = input
  const projects = new Set([...documents.map((doc) => doc.projectId), ...folders.map((folder) => folder.projectId)])
  const projectsWithFolders = new Set(folders.map((folder) => folder.projectId)).size
  const number = learnPattern(documents, (doc) => (doc.documentNumber ? documentNumberShape(doc.documentNumber) : null))
  const revision = learnPattern(documents, (doc) => (doc.revision ? revisionStyleOf(doc.revision) : null))
  const date = learnPattern(documents, (doc) => fileDateFormatOf(doc.filename, doc.uploadedAt))
  return {
    version: EXTRACTOR_VERSION,
    projects: projects.size,
    folders: learnSkeleton(folders, projectsWithFolders),
    filing: learnFiling(documents, moves),
    documentNumber: number && { shape: number.value, projects: number.projects, of: number.of },
    revisionStyle: revision && { style: revision.value, projects: revision.projects, of: revision.of },
    fileDate: date && { format: date.value, projects: date.projects, of: date.of },
  }
}

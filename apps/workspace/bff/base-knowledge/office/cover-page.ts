import type { KnowledgeCoverOverride, KnowledgeCoverReading } from '@/lib/db/schema/knowledge-records'
import { UNKNOWN_EDITION, type ProposeEntryBody } from '../wire'
import { proposeFromReading, readDesignation, readDesignations } from './reading'
import { workDesignation } from './work-designation'

export interface CoverEdition {
  label: string
  issuedOn: string | null
}

export interface CoverReading {
  designation: string | null
  title: string | null
  edition: CoverEdition | null
  replaces: { designation: string; editionLabel: string | null }[]
}

const MONTHS: Readonly<Record<string, string>> = {
  januar: '01', jänner: '01', jaenner: '01', january: '01',
  februar: '02', feber: '02', february: '02',
  märz: '03', maerz: '03', march: '03',
  april: '04',
  mai: '05', may: '05',
  juni: '06', june: '06',
  juli: '07', july: '07',
  august: '08',
  september: '09',
  oktober: '10', october: '10',
  november: '11',
  dezember: '12', december: '12',
}
const MONTH_NAME = Object.keys(MONTHS).join('|')
const YEAR = '((?:19|20)\\d{2})'
const DAY = '(0?[1-9]|[12]\\d|3[01])'

const DATES: readonly { pattern: RegExp; read: (match: RegExpExecArray) => CoverEdition }[] = [
  { pattern: new RegExp(`(?<!\\d)${YEAR}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])(?!\\d)`), read: ([, y, m, d]) => day(y, m, d) },
  { pattern: new RegExp(`(?<!\\d)${DAY}\\.\\s?(0?[1-9]|1[0-2])\\.\\s?${YEAR}(?!\\d)`), read: ([, d, m, y]) => day(y, m, d) },
  { pattern: new RegExp(`(?<!\\d)${DAY}\\.?\\s+(${MONTH_NAME})\\s+${YEAR}(?!\\d)`, 'iu'), read: ([, d, m, y]) => day(y, MONTHS[m.toLowerCase()], d) },
  { pattern: new RegExp(`(?<!\\d)${YEAR}-(0[1-9]|1[0-2])(?![\\d-])`), read: ([, y, m]) => ({ label: `${y}-${m}`, issuedOn: null }) },
  { pattern: new RegExp(`(?<![\\p{L}])(${MONTH_NAME})\\s+${YEAR}(?!\\d)`, 'iu'), read: ([, m, y]) => ({ label: `${y}-${MONTHS[m.toLowerCase()]}`, issuedOn: null }) },
]

const EDITION_LABEL = /\b(?:Ausgabe(?:datum)?|Edition|Datum|Date|Stand)\b\s*[:.]?\s*/iu
const PLACE_BEFORE_DATE = /^[^,\d]{2,40},\s*(?:am\s+|den\s+)?/iu
const REPLACES = /\b(?:Ersatz\s+für|ersetzt|Supersedes|Replaces|Remplace)\b\s*:?/iu
const CONTINUES_LIST = /^(?:und|and|et|,)\s+/iu
const SUBJECT = /^\s*Betreff\s*:\s*(.+)$/iu
const BOILERPLATE = /^(?:ICS\b|Normengruppe|Normungsgruppe|English version|Deutsche Fassung|Version française|Medieninhaber|Copyright|©)/iu
const WORD = /\p{L}{3,}/gu
const SHORTEST_TITLE = 8
const LONGEST_TITLE = 300

function day(year: string, month: string, date: string): CoverEdition {
  const iso = `${year}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`
  return { label: iso, issuedOn: iso }
}

function dateIn(text: string): { edition: CoverEdition; rest: string } | null {
  for (const { pattern, read } of DATES) {
    const match = pattern.exec(text)
    if (match) return { edition: read(match), rest: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim() }
  }
  return null
}

function onlyDate(line: string): CoverEdition | null {
  for (const candidate of [line, line.replace(PLACE_BEFORE_DATE, '')]) {
    const found = dateIn(candidate.trim())
    if (found && found.rest === '') return found.edition
  }
  return null
}

function labelledDate(line: string): CoverEdition | null {
  const label = EDITION_LABEL.exec(line)
  return label ? (dateIn(line.slice(label.index + label[0].length))?.edition ?? null) : null
}

function readEdition(lines: readonly string[]): CoverEdition | null {
  for (const line of lines) {
    const labelled = labelledDate(line)
    if (labelled) return labelled
  }
  for (const line of lines) {
    const bare = onlyDate(line)
    if (bare) return bare
  }
  return null
}

const startsWithDesignation = (line: string) => readDesignation(line.replace(CONTINUES_LIST, ''))?.start === 0

function replacementLines(lines: readonly string[]): Set<number> {
  const taken = new Set<number>()
  lines.forEach((line, index) => {
    if (!REPLACES.test(line)) return
    taken.add(index)
    for (let next = index + 1; next < lines.length && startsWithDesignation(lines[next]); next += 1) taken.add(next)
  })
  return taken
}

function readReplaced(lines: readonly string[], taken: ReadonlySet<number>): CoverReading['replaces'] {
  const text = [...taken]
    .map((index) => {
      const keyword = REPLACES.exec(lines[index])
      return keyword ? lines[index].slice(keyword.index + keyword[0].length) : lines[index]
    })
    .join('\n')
  const seen = new Set<string>()
  return readDesignations(text).flatMap(({ designation, edition }) => {
    const work = workDesignation(designation) ?? designation
    const key = `${work}|${edition ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ designation: work, editionLabel: edition }]
  })
}

function isTitle(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < SHORTEST_TITLE || (trimmed.match(WORD)?.length ?? 0) < 2) return false
  if (trimmed === trimmed.toUpperCase() || BOILERPLATE.test(trimmed) || REPLACES.test(trimmed)) return false
  return !labelledDate(trimmed) && !onlyDate(trimmed) && !startsWithDesignation(trimmed)
}

function readTitle(lines: readonly string[], designationLine: number | null): string | null {
  const subject = lines.map((line) => SUBJECT.exec(line)?.[1]?.trim()).find(Boolean)
  if (subject) return subject.slice(0, LONGEST_TITLE)
  if (designationLine === null) return null
  return lines.slice(designationLine + 1).find(isTitle)?.trim().slice(0, LONGEST_TITLE) ?? null
}

export function readCover(text: string): CoverReading {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const taken = replacementLines(lines)
  const own = lines.map((line, index) => ({ line, index })).filter(({ index }) => !taken.has(index))
  const designated = own.find(({ line }) => readDesignation(line))
  const designation = designated ? readDesignation(designated.line) : null
  return {
    designation: designation ? (workDesignation(designation.designation) ?? designation.designation) : null,
    title: readTitle(lines, designated?.index ?? null),
    edition: readEdition(own.map(({ line }) => line)),
    replaces: readReplaced(lines, taken),
  }
}

export type CoverValues = Pick<ProposeEntryBody, 'designation' | 'editionLabel' | 'issuedOn' | 'title'>

export interface ProposalReading {
  values: CoverValues
  cover: KnowledgeCoverReading | null
}

const compactDesignation = (designation: string) => (workDesignation(designation) ?? designation).replace(/\s+/g, '').toUpperCase()

const consistent = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

function fileEdition(fileName: string): CoverEdition | null {
  const read = proposeFromReading({ fileName }, {})
  return read.editionLabel === UNKNOWN_EDITION ? null : { label: read.editionLabel, issuedOn: read.issuedOn }
}

function chooseEdition(cover: CoverEdition | null, file: CoverEdition | null): { edition: CoverEdition | null; source: 'cover' | 'file_name' | null } {
  if (cover && file && consistent(cover.label, file.label) && file.label.length > cover.label.length) return { edition: file, source: 'file_name' }
  if (cover) return { edition: cover, source: 'cover' }
  return { edition: file, source: file ? 'file_name' : null }
}

export function proposalReading(fileName: string, fileDesignation: string | null, cover: CoverReading | null): ProposalReading {
  const designation = cover?.designation ?? fileDesignation
  const fromFile = fileEdition(fileName)
  const { edition, source } = chooseEdition(cover?.edition ?? null, fromFile)
  const values: CoverValues = {
    ...(designation ? { designation } : {}),
    ...(edition && source === 'cover' ? { editionLabel: edition.label, issuedOn: edition.issuedOn } : {}),
    ...(cover?.title ? { title: cover.title } : {}),
  }
  if (!cover || (!cover.designation && !cover.edition && !cover.title && cover.replaces.length === 0)) return { values, cover: null }
  const overrode: KnowledgeCoverOverride[] = [
    ...(cover.designation && fileDesignation && compactDesignation(cover.designation) !== compactDesignation(fileDesignation)
      ? [{ field: 'designation' as const, fileName: fileDesignation }]
      : []),
    ...(cover.edition && fromFile && !consistent(cover.edition.label, fromFile.label) ? [{ field: 'editionLabel' as const, fileName: fromFile.label }] : []),
  ]
  return {
    values,
    cover: {
      read: {
        designation: cover.designation ? 'cover' : fileDesignation ? 'file_name' : null,
        editionLabel: source,
        title: cover.title ? 'cover' : 'file_name',
      },
      overrode,
      replaces: cover.replaces,
    },
  }
}

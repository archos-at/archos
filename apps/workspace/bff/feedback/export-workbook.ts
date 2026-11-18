import 'server-only'
import ExcelJS from 'exceljs'

type Workbook = ExcelJS.Workbook
type Worksheet = ExcelJS.Worksheet
import { interpolate } from '@/i18n/translate'
import { PRODUCT_NAME } from '@/lib/brand'
import {
  FEEDBACK_EXPORT_COLUMNS,
  FEEDBACK_WEEKLY_COLUMNS,
  helpfulRate,
  type Dictionary,
  type ExportCell,
  type ExportColumn,
  type ExportFormat,
} from './export-columns'
import type { FeedbackExport, NamedScopeEntry } from './export-service'

export const XLSX_MAX_CELL_CHARS = 32_767

const NUM_FMT: Partial<Record<ExportFormat, string>> = {
  datetime: 'yyyy-mm-dd hh:mm:ss',
  date: 'yyyy-mm-dd',
  integer: '0',
  decimal: '0.0000',
  usd: '0.000000',
  seconds: '0.0',
  boolean: '0',
  percent: '0.0%',
}

const LINK_FONT = { color: { argb: 'FF1F5FBF' }, underline: true } as const
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F4' } } as const

function cellValue(value: ExportCell): string | number | Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value)) return value.length ? value.join('; ') : null
  if (typeof value === 'string' && value.length > XLSX_MAX_CELL_CHARS) {
    return `${value.slice(0, XLSX_MAX_CELL_CHARS - 1)}…`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value as string | number | Date
}

function addTable<Row>(
  workbook: Workbook,
  name: string,
  columns: readonly ExportColumn<Row>[],
  rows: readonly Row[],
  dictionary: Dictionary
): Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((column) => ({
    header: column.label(dictionary),
    key: column.key,
    width: column.width,
    style: {
      numFmt: NUM_FMT[column.format],
      alignment: column.wrap ? { wrapText: true, vertical: 'top' } : { vertical: 'top' },
    },
  }))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = HEADER_FILL
  header.alignment = { vertical: 'middle', wrapText: true }

  for (const row of rows) {
    const added = sheet.addRow(columns.map((column) => cellValue(column.value(row, dictionary))))
    columns.forEach((column, index) => {
      if (column.format !== 'url') return
      const cell = added.getCell(index + 1)
      const url = column.value(row, dictionary)
      if (typeof url !== 'string' || !url) return
      cell.value = { text: column.label(dictionary), hyperlink: url }
      cell.font = LINK_FONT
    })
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return sheet
}

function anyOf(values: readonly string[], dictionary: Dictionary): string {
  return values.join(dictionary.feedbackExport.overview.filterOr)
}

function describeNamed(entries: readonly NamedScopeEntry[], dictionary: Dictionary): string {
  if (entries.length === 0) return dictionary.feedbackExport.overview.scopeEverything
  return entries.map((entry) => entry.name ?? entry.id).join('; ')
}

export function describeRatingsFilters(data: Pick<FeedbackExport, 'query'>, dictionary: Dictionary): string {
  const words = dictionary.feedbackExport.overview
  const labels = dictionary.platform.answerFeedback
  const { ratings } = data.query
  const parts: string[] = []
  if (ratings.verdict) {
    parts.push(interpolate(words.filterVerdict, { value: dictionary.feedbackExport.verdicts[ratings.verdict] }))
  }
  if (ratings.reasons.length) {
    const value = anyOf(ratings.reasons.map((key) => labels.reasons[key]), dictionary)
    parts.push(interpolate(words.filterReasons, { value }))
  }
  if (ratings.topics.length) {
    const value = anyOf(ratings.topics.map((key) => labels.topics[key]), dictionary)
    parts.push(interpolate(words.filterTopics, { value }))
  }
  if (ratings.modes.length) {
    const value = anyOf(ratings.modes.map((key) => labels.modes[key]), dictionary)
    parts.push(interpolate(words.filterModes, { value }))
  }
  if (ratings.confidences.length) {
    const value = anyOf(ratings.confidences.map((key) => labels.confidences[key]), dictionary)
    parts.push(interpolate(words.filterConfidences, { value }))
  }
  if (ratings.hasComment) parts.push(words.filterHasComment)
  if (ratings.hasExpectedAnswer) parts.push(words.filterHasExpected)
  if (ratings.query) parts.push(interpolate(words.filterQuery, { value: ratings.query }))
  return parts.length ? parts.join(' · ') : words.filterNone
}

function describeWeeklyFilters(data: FeedbackExport, dictionary: Dictionary): string {
  const words = dictionary.feedbackExport.overview
  if (data.weeksIgnored.length === 0) return words.weeksAllApplied
  const filters = data.weeksIgnored.map((key) => words.filterNames[key]).join(', ')
  return interpolate(words.weeksIgnored, { filters })
}

function addOverview(workbook: Workbook, data: FeedbackExport, dictionary: Dictionary): void {
  const words = dictionary.feedbackExport.overview
  const sheet = workbook.addWorksheet(dictionary.feedbackExport.sheets.overview)
  sheet.columns = [{ width: 46 }, { width: 70, style: { alignment: { wrapText: true, vertical: 'top' } } }]
  const yesNo = (value: boolean): string => (value ? words.yes : words.no)
  const totals = data.totals

  const add = (label: string, value: string | number | Date | null, numFmt?: string): void => {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
    if (numFmt) row.getCell(2).numFmt = numFmt
    row.getCell(2).alignment = { horizontal: 'left', wrapText: true, vertical: 'top' }
  }
  const gap = (): void => {
    sheet.addRow([])
  }

  const title = sheet.addRow([`${PRODUCT_NAME} · ${words.title}`])
  title.font = { bold: true, size: 14 }
  gap()
  const { scope } = data.query
  add(words.generatedAt, data.generatedAt, NUM_FMT.datetime)
  add(words.windowFrom, new Date(`${scope.from}T00:00:00Z`), NUM_FMT.date)
  add(words.windowTo, new Date(`${scope.to}T00:00:00Z`), NUM_FMT.date)
  add(words.organizationsScope, describeNamed(data.named.organizations, dictionary))
  add(words.projectsScope, describeNamed(data.named.projects, dictionary))
  add(words.filters, describeRatingsFilters(data, dictionary))
  add(
    interpolate(words.weeksFilters, { sheet: dictionary.feedbackExport.sheets.weeks }),
    describeWeeklyFilters(data, dictionary)
  )
  if (totals) {
    gap()
    add(words.votes, totals.votes, '0')
    add(words.up, totals.up, '0')
    add(words.down, totals.down, '0')
    add(words.helpfulRate, helpfulRate(totals.up, totals.down), NUM_FMT.percent)
    add(words.voters, totals.voters, '0')
    add(words.organizations, totals.organizations, '0')
  }
  gap()
  add(interpolate(words.rows, { sheet: dictionary.feedbackExport.sheets.votes }), data.records.length, '0')
  add(words.rowCap, data.cap, '0')
  add(words.rowCapHit, yesNo(data.truncated))
  add(words.weeksCapHit, yesNo(data.weeksTruncated))
  gap()
  const notes = sheet.addRow([words.notesHeading])
  notes.font = { bold: true }
  for (const note of [words.noteVoluntary, words.noteErased, words.noteTimes]) {
    const row = sheet.addRow([note])
    sheet.mergeCells(row.number, 1, row.number, 2)
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    row.height = 32
  }
}

function addColumnsSheet(workbook: Workbook, dictionary: Dictionary): void {
  const words = dictionary.feedbackExport
  const sheet = workbook.addWorksheet(words.sheets.columns, { views: [{ state: 'frozen', ySplit: 1 }] })
  const wrap = { wrapText: true, vertical: 'top' } as const
  sheet.columns = [
    { header: words.dictionaryHeader.key, width: 26, style: { alignment: wrap } },
    { header: words.dictionaryHeader.label, width: 28, style: { alignment: wrap } },
    { header: words.dictionaryHeader.description, width: 80, style: { alignment: wrap } },
    { header: words.dictionaryHeader.format, width: 30, style: { alignment: wrap } },
    { header: words.dictionaryHeader.source, width: 46, style: { alignment: wrap } },
  ]
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = HEADER_FILL

  const section = <Row>(title: string, columns: readonly ExportColumn<Row>[]): void => {
    const heading = sheet.addRow([title])
    heading.font = { bold: true }
    for (const column of columns) {
      sheet.addRow([
        column.key,
        column.label(dictionary),
        column.description(dictionary),
        words.formats[column.format],
        column.source,
      ])
    }
  }
  section(words.sheets.votes, FEEDBACK_EXPORT_COLUMNS)
  sheet.addRow([])
  section(words.sheets.weeks, FEEDBACK_WEEKLY_COLUMNS)
}

export async function renderFeedbackWorkbook(data: FeedbackExport, dictionary: Dictionary): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = PRODUCT_NAME
  workbook.created = data.generatedAt
  workbook.modified = data.generatedAt

  addTable(workbook, dictionary.feedbackExport.sheets.votes, FEEDBACK_EXPORT_COLUMNS, data.records, dictionary)
  addTable(workbook, dictionary.feedbackExport.sheets.weeks, FEEDBACK_WEEKLY_COLUMNS, data.weeks, dictionary)
  addOverview(workbook, data, dictionary)
  addColumnsSheet(workbook, dictionary)

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

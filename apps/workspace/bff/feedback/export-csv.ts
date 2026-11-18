import { csvCell } from '@/lib/text/csv-cell'
import type { Dictionary, ExportCell, ExportColumn, ExportFormat } from './export-columns'

const DECIMALS: Partial<Record<ExportFormat, number>> = {
  usd: 6,
  seconds: 3,
  percent: 4,
  decimal: 4,
}

export function csvValue(value: ExportCell, format: ExportFormat): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return format === 'date' ? value.toISOString().slice(0, 10) : value.toISOString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Array.isArray(value)) return value.join(';')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const places = DECIMALS[format]
    if (places === undefined) return String(Math.round(value))
    return value.toFixed(places).replace(/\.?0+$/, '')
  }
  return String(value)
}

export function renderCsv<Row>(
  columns: readonly ExportColumn<Row>[],
  rows: readonly Row[],
  dictionary: Dictionary
): string {
  const header = columns.map((column) => column.key).join(',')
  const lines = rows.map((row) =>
    columns.map((column) => csvCell(csvValue(column.value(row, dictionary), column.format))).join(',')
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}

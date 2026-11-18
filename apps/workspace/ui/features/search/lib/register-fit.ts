export interface ColumnFit {
  min: number
  want: number
  rest?: boolean
}

export const NAME_MIN_REM = 12

const NAME_FIRST_REM = 18

const ADVANCE = {
  header: 0.47,
  text: 0.45,
  strong: 0.47,
  code: 0.45,
  mark: 0.43,
} as const

const CELL_PAD = 1.25
const HEADER_EXTRA = 2
const MARK_EXTRA = 1.75

export type CellSetting = keyof typeof ADVANCE

export const headerRem = (label: string): number => round(label.length * ADVANCE.header + HEADER_EXTRA)

export function valuesRem(values: ReadonlyArray<string | null | undefined>, setting: Exclude<CellSetting, 'header'>): number {
  const longest = values.reduce<number>((most, value) => Math.max(most, value ? [...value].length : 0), 0)
  if (longest === 0) return 0
  return round(longest * ADVANCE[setting] + CELL_PAD + (setting === 'mark' ? MARK_EXTRA : 0))
}

const round = (rem: number): number => Math.ceil(rem * 4) / 4

export function fitColumns(columns: readonly ColumnFit[], room: number): Array<number | null> {
  const widths = columns.map((column) => Math.max(column.min, column.rest ? NAME_MIN_REM : 0))
  let left = room - widths.reduce((sum, width) => sum + width, 0)
  const grant = (index: number, upTo: number): void => {
    if (left <= 0) return
    const more = Math.min(left, Math.max(0, upTo - widths[index]!))
    widths[index]! += more
    left -= more
  }
  columns.forEach((column, index) => {
    if (column.rest) grant(index, Math.min(column.want, NAME_FIRST_REM))
  })
  columns.forEach((column, index) => {
    if (!column.rest) grant(index, column.want)
  })
  return columns.map((column, index) => (column.rest ? null : widths[index]!))
}

export function minimumRem(columns: readonly ColumnFit[]): number {
  return columns.reduce((sum, column) => sum + Math.max(column.min, column.rest ? NAME_MIN_REM : 0), 0)
}

export function withoutLegalForm(name: string): string {
  const short = name.replace(/[\s,]+(?:ZT[\s-]+)?(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|KG|OG|e\.\s?U\.|GesbR|Ges\.m\.b\.H\.)$/u, '').trim()
  return short || name
}

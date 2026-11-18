export type DecimalInput =
  | { status: 'blank' }
  | { status: 'valid'; value: number }
  | { status: 'invalid'; reason: 'notANumber' | 'ambiguous' }

const DECIMAL = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/

const GROUPED_THOUSAND: Record<string, RegExp> = {
  '.': /^[+-]?[1-9]\d{0,2}\.\d{3}$/,
  ',': /^[+-]?[1-9]\d{0,2},\d{3}$/,
}

const separator = (locale: string | undefined, type: 'decimal' | 'group'): string | undefined =>
  new Intl.NumberFormat(locale).formatToParts(1234.5).find((part) => part.type === type)?.value

export function parseDecimalInput(raw: string, locale?: string): DecimalInput {
  const text = raw.trim()
  if (text === '') return { status: 'blank' }
  if (!DECIMAL.test(text)) return { status: 'invalid', reason: 'notANumber' }

  const ambiguous = GROUPED_THOUSAND[separator(locale, 'group') ?? '']
  if (ambiguous?.test(text)) {
    return { status: 'invalid', reason: 'ambiguous' }
  }

  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value)
    ? { status: 'valid', value }
    : { status: 'invalid', reason: 'notANumber' }
}

export function formatDecimalInput(value: number | null, locale?: string): string {
  if (value === null || !Number.isFinite(value)) return ''
  const text = String(value)
  const plain = /e/i.test(text)
    ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
    : text
  return plain.replace('.', separator(locale, 'decimal') ?? '.')
}

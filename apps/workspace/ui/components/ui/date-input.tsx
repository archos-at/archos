'use client'

import { useState, type JSX, type KeyboardEvent } from 'react'

import { Input } from '@/components/ui/input'

type Part = 'day' | 'month' | 'year'

export interface DateInputProps {
  value: string
  onChange: (value: string) => void
  locale: string
  tokens: Record<Part, string>
  placeholderPrefix?: string
  id?: string
  'aria-label'?: string
  min?: string
  max?: string
  'data-testid'?: string
}

interface Pattern {
  order: Part[]
  separator: string
}

export function datePattern(locale: string): Pattern {
  const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).formatToParts(
    new Date(Date.UTC(2026, 10, 27))
  )
  const order = parts.flatMap((part) => (part.type === 'day' || part.type === 'month' || part.type === 'year' ? [part.type] : []))
  const separator = parts.find((part) => part.type === 'literal')?.value ?? '.'
  return { order: order.length === 3 ? order : ['day', 'month', 'year'], separator }
}

export function formatDateValue(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return ''
  const { order, separator } = datePattern(locale)
  const byPart: Record<Part, string> = { year: match[1], month: match[2], day: match[3] }
  return order.map((part) => byPart[part]).join(separator)
}

export function parseDateText(text: string, locale: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const { order } = datePattern(locale)
  const numbers = splitDigitsOnly(trimmed, order) ?? trimmed.split(/\D+/).filter(Boolean)
  if (numbers.length !== 3) return null
  const byPart = Object.fromEntries(order.map((part, index) => [part, Number(numbers[index])])) as Record<Part, number>
  const year = numbers[order.indexOf('year')].length <= 2 ? 2000 + byPart.year : byPart.year
  const date = new Date(Date.UTC(year, byPart.month - 1, byPart.day))
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== byPart.month - 1 || date.getUTCDate() !== byPart.day) return null
  return date.toISOString().slice(0, 10)
}

const PART_DIGITS: Record<Part, number> = { day: 2, month: 2, year: 4 }

function splitDigitsOnly(text: string, order: Part[]): string[] | null {
  if (!/^\d+$/.test(text)) return null
  const yearDigits = text.length === 8 ? 4 : text.length === 6 ? 2 : null
  if (yearDigits === null) return null
  let at = 0
  return order.map((part) => {
    const length = part === 'year' ? yearDigits : PART_DIGITS[part]
    const piece = text.slice(at, at + length)
    at += length
    return piece
  })
}

export function maskDateDraft(previous: string, next: string, { order, separator }: Pattern): string {
  if (next.length !== previous.length + 1 || !next.startsWith(previous)) return next
  const typed = next.slice(-1)
  if (typed === separator) return previous.endsWith(separator) || previous === '' ? previous : next
  if (!/\d/.test(typed)) return next
  const parts = previous.split(separator)
  const index = parts.length - 1
  const part = order[index]
  if (!part || index >= order.length - 1 || !/^\d*$/.test(parts[index] ?? '')) return next
  const width = PART_DIGITS[part]
  const current = (parts[index] ?? '') + typed
  if (current.length === width) return `${next}${separator}`
  if (current.length > width) return `${previous}${separator}${typed}`
  return next
}

export function DateInput(props: DateInputProps): JSX.Element {
  return <DateInputField key={props.value} {...props} />
}

function DateInputField({ value, onChange, locale, tokens, placeholderPrefix, id, min, max, ...rest }: DateInputProps): JSX.Element {
  const [draft, setDraft] = useState(() => formatDateValue(value, locale))
  const [invalid, setInvalid] = useState(false)
  const pattern = datePattern(locale)
  const { order, separator } = pattern
  const commit = (): void => {
    const parsed = parseDateText(draft, locale)
    const outside = parsed !== null && parsed !== '' && ((min !== undefined && parsed < min) || (max !== undefined && parsed > max))
    if (parsed === null || outside) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (parsed !== value) onChange(parsed)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      placeholder={[placeholderPrefix, order.map((part) => tokens[part]).join(separator)].filter(Boolean).join(' ')}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        setDraft(maskDateDraft(draft, event.target.value, pattern))
        if (invalid) setInvalid(false)
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      {...rest}
    />
  )
}

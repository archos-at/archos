'use client'

import { useMemo } from 'react'

export function useNumberFormats(locale: string): {
  count: (value: number) => string
  percent: (value: number) => string
  decimal: (value: number) => string
} {
  return useMemo(() => {
    const count = new Intl.NumberFormat(locale)
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
    return {
      count: (value) => count.format(value),
      percent: (value) => percent.format(value),
      decimal: (value) => decimal.format(value),
    }
  }, [locale])
}

const FORMAT_CONTROLS = /\p{Cf}/gu

const CONTROLS = /\p{Cc}/gu

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function stripFormatControls(value: string): string {
  return value.replace(FORMAT_CONTROLS, '')
}

export function singleLine(value: string): string {
  return stripFormatControls(value).replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim()
}

export function truncateGraphemes(value: string, maxLength: number, ellipsis = ''): string {
  if (value.length <= maxLength) return value
  const budget = maxLength - ellipsis.length
  if (budget <= 0) return ''
  let kept = ''
  for (const { segment } of segmenter.segment(value)) {
    if (kept.length + segment.length > budget) break
    kept += segment
  }
  return kept + ellipsis
}

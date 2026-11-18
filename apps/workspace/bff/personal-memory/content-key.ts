import { BadRequestError } from '@/lib/api/errors'

const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu

export function personalContentKey(content: string): string {
  return content.normalize('NFKC').toLowerCase().replace(NOT_LETTER_OR_DIGIT, ' ').trim()
}

export function requirePersonalContentKey(content: string): string {
  const key = personalContentKey(content)
  if (!key) throw new BadRequestError('A personal note needs at least one letter or digit.')
  return key
}

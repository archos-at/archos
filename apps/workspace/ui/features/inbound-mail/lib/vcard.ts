import { fileSlug } from '@/lib/text/latinize'
import { PRODUCT_NAME } from '@/lib/brand'

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r\n|\r|\n/g, '\\n')
}

function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  for (const char of line) {
    const limit = out.length === 0 ? 75 : 74
    if (encoder.encode(current + char).length > limit) {
      out.push(current)
      current = char
    } else {
      current += char
    }
  }
  out.push(current)
  return out.join('\r\n ')
}

export interface ContactCard {
  name: string
  address: string
  note?: string
}

export function contactCard({ name, address, note }: ContactCard): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `FN:${escapeText(name)}`,
    'KIND:individual',
    `EMAIL;TYPE=work:${escapeText(address)}`,
    ...(note ? [`NOTE:${escapeText(note)}`] : []),
    'END:VCARD',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

export function contactCardFileName(projectName: string): string {
  return `${fileSlug(PRODUCT_NAME)}-${fileSlug(projectName, { maxLength: 60 }) || 'project'}.vcf`
}

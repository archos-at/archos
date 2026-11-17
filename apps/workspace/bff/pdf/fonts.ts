import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '@react-pdf/renderer'

const WORDMARK_FILE = join(process.cwd(), 'shared', 'brand', 'fonts', 'Switzer-Semibold.woff2')

// General Sans is not embedded: the brand ships only the variable font, which rendered wrong in pdftoppm (2026-10-29).
const WORDMARK_FAMILY = 'Switzer'

let wordmarkFace: { fontFamily: string; fontWeight?: 'bold' } | null = null

export function wordmarkFontStyle(): { fontFamily: string; fontWeight?: 'bold' } {
  if (wordmarkFace) return wordmarkFace
  if (existsSync(WORDMARK_FILE)) {
    Font.register({ family: WORDMARK_FAMILY, src: WORDMARK_FILE })
    wordmarkFace = { fontFamily: WORDMARK_FAMILY }
  } else {
    wordmarkFace = { fontFamily: 'Helvetica', fontWeight: 'bold' }
  }
  return wordmarkFace
}

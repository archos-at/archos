// @disk-inputs: ui/features/documents/components/mail-import-dialog.tsx, ui/features/documents/components/office-shelf-workspace.tsx, ui/features/documents/components/upload-tray.tsx, ui/features/uploads/components/upload-history.tsx

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'

const FEATURES = join(__dirname, '..')
const read = (...parts: string[]): string =>
  blankComments(readFileSync(join(FEATURES, ...parts), 'utf8')) as string

describe('Archiv header', () => {
  const source = read('documents', 'components', 'office-shelf-workspace.tsx')

  it('lets the controls group shrink to the card instead of keeping its single-line width', () => {
    const group = source.match(/data-testid="office-shelf-controls"/)
    expect(group).not.toBeNull()
    const open = source.lastIndexOf('<div', group!.index)
    const classes = source.slice(open, group!.index)
    expect(classes).toContain('min-w-0')
    expect(classes).not.toMatch(/\bshrink-0\b/)
  })

  it('puts the controls in a row of their own under the title, at every width', () => {
    const row = source.indexOf('<SectionToolRow className')
    expect(row).toBeGreaterThan(source.indexOf('<PageHeader'))
    expect(source.indexOf('data-testid="office-shelf-controls"')).toBeGreaterThan(row)
  })
})

describe('upload tray rows', () => {
  const source = read('documents', 'components', 'upload-tray.tsx')

  it('keeps the end of a file name', () => {
    expect(source).toContain('<MiddleTruncate text={file.fileName}')
  })

  it('draws no text under 12px; the extension chip is the shared tile, not a copy', () => {
    const small = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].filter((m) => Number(m[1]) < 12)
    expect(small.map((m) => m[0])).toEqual([])
    expect(source).toContain('<FileExtChip filename={file.fileName} size="xs"')
  })
})

describe('mail import rows', () => {
  const source = read('documents', 'components', 'mail-import-dialog.tsx')

  it('wraps the actions under the text on a phone, so the name keeps its width', () => {
    expect(source).toMatch(/<Item as="li" className="flex-wrap/)
    expect(source).toMatch(/<ItemActions className="[^"]*max-sm:basis-full/)
  })
})

describe('upload history rows', () => {
  it('keeps the summary link inside the content, so the pills get the whole row', () => {
    expect(read('uploads', 'components', 'upload-history.tsx')).not.toContain('<ItemActions')
  })
})

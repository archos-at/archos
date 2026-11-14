// @disk-inputs: ui/components/ui/input.tsx, ui/components/ui/textarea.tsx, ui/components/ui/select.tsx, ui/components/ui/tag-input.tsx, ui/features/layout/components/InputArea.tsx
/**
 * A text field's focus is its border turning ink, and nothing more (Notion #38,
 * „Texteingabefelder bekommen beim Anklicken eine zu dicke Markierung"). A
 * field shows `:focus-visible` on a mouse click, so a halo or the global
 * keyboard outline on it is drawn on every click into it. Held here: the field
 * recipes carry no ring width and switch the global outline off, and every
 * shared field composes them rather than spelling a ring of its own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIELD_FOCUS_RING, FIELD_FOCUS_WITHIN_RING, FOCUS_RING } from './focus-ring'

const ROOT = join(__dirname, '..', '..', '..')

describe('field focus', () => {
  it.each([
    ['FIELD_FOCUS_RING', FIELD_FOCUS_RING],
    ['FIELD_FOCUS_WITHIN_RING', FIELD_FOCUS_WITHIN_RING],
  ])('%s turns the border ink and draws no ring or outline', (_, recipe) => {
    expect(recipe).toMatch(/:border-ring\b/)
    expect(recipe).not.toMatch(/ring-(\d|\[)/)
    expect(recipe).toMatch(/outline-hidden!/)
  })

  it('the control ring is untouched: buttons keep their offset ring', () => {
    expect(FOCUS_RING).toContain('focus-visible:ring-2')
  })

  it.each([
    ['ui/components/ui/input.tsx', 'FIELD_FOCUS_RING'],
    ['ui/components/ui/textarea.tsx', 'FIELD_FOCUS_RING'],
    ['ui/components/ui/select.tsx', 'FIELD_FOCUS_RING'],
    ['ui/components/ui/tag-input.tsx', 'FIELD_FOCUS_WITHIN_RING'],
    ['ui/features/layout/components/InputArea.tsx', 'FIELD_FOCUS_WITHIN_RING'],
  ])('%s composes %s and spells no focus ring of its own', (file, recipe) => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    expect(text).toContain(recipe)
    expect(text).not.toMatch(/focus-(visible|within):ring-(\d|\[)/)
  })
})

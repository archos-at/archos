/**
 * @vitest-environment node
 *
 * What a citation style record may say: templates name only the fields the
 * interpreter fills, one style per language. The lines themselves are the
 * fixture's (`shared/citation-lines.fixture.spec.ts`).
 */

import { describe, expect, it } from 'vitest'
import { fillTemplate } from '@/shared/citation-style'
import { citationStyleSchema } from './citation-style'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'

const style = FALLBACK_CITATION_STYLES.styles[0]

describe('citationStyleSchema', () => {
  it('refuses a field the interpreter does not fill, and an unmatched brace', () => {
    const unknown = citationStyleSchema.safeParse({ styles: [{ ...style, page: 'p. {folio}' }] })
    expect(unknown.error?.issues[0]).toMatchObject({ path: ['styles', 0, 'page'], message: expect.stringContaining('{folio}') })
    const unmatched = citationStyleSchema.safeParse({ styles: [{ ...style, lines: { ...style.lines, report: ['{title', '.'] } }] })
    expect(unmatched.error?.issues[0]?.message).toBe('an unmatched { or }')
  })

  it('takes one style per language', () => {
    expect(citationStyleSchema.safeParse({ styles: [style, style] }).success).toBe(false)
  })
})

describe('fillTemplate', () => {
  it('prints a segment only when every field in it has a value, and a segment without one always', () => {
    const template = ['{title}', ', {page}', ' ({publisher}, {place})', '.']
    expect(fillTemplate(template, { title: 'T', page: '3', publisher: 'P' })).toBe('T, 3.')
    expect(fillTemplate(template, { title: 'T', publisher: 'P', place: 'X' })).toBe('T (P, X).')
  })
})

import { describe, expect, it } from 'vitest'
import { baseKnowledgeEntryOf, baseKnowledgeHref } from './entry-link'

describe('a link into Normen & Richtlinien', () => {
  it('opens the entry page or the viewer of one entry, and the tab without one', () => {
    expect(baseKnowledgeHref('edition 1')).toBe('/app/base-knowledge?entry=edition%201')
    expect(baseKnowledgeHref('edition 1', 'file')).toBe('/app/base-knowledge?file=edition%201')
    expect(baseKnowledgeHref(null)).toBe('/app/base-knowledge')
    expect(baseKnowledgeHref('  ', 'file')).toBe('/app/base-knowledge')
  })

  it('reads the entry back from either link, and nothing from elsewhere', () => {
    expect(baseKnowledgeEntryOf('/app/base-knowledge?entry=edition%201')).toBe('edition 1')
    expect(baseKnowledgeEntryOf('/app/base-knowledge?file=edition_2')).toBe('edition_2')
    expect(baseKnowledgeEntryOf('/app/base-knowledge')).toBeNull()
    expect(baseKnowledgeEntryOf('/app/office-shelf?entry=x')).toBeNull()
    expect(baseKnowledgeEntryOf(null)).toBeNull()
  })
})

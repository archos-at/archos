/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { GENERATED_DOCUMENT_PRODUCERS } from '@/lib/documents/generated'
import {
  DIAGRAM_SOURCE_FACTS,
  DIAGRAM_SOURCE_KINDS,
  MAX_DIAGRAM_SVG_BYTES,
  isDiagramSourceKind,
} from './diagram-sources'
import { DIAGRAM_SVG_REJECTIONS } from './svg'
import { PRODUCT_NAME } from '@/lib/brand'

describe('the diagram source vocabulary', () => {
  it('starts with the two kinds a model can write', () => {
    expect([...DIAGRAM_SOURCE_KINDS]).toEqual(['mermaid', 'excalidraw'])
  })

  it('states facts for every member, derived rather than restated', () => {
    for (const kind of DIAGRAM_SOURCE_KINDS) {
      const facts = DIAGRAM_SOURCE_FACTS[kind]
      expect(facts.contentType).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
      expect(facts.extension).toMatch(/^[a-z]+$/)
      expect(facts.maxSourceBytes).toBeGreaterThan(0)
      expect(facts.maxSourceBytes).toBeLessThan(MAX_DIAGRAM_SVG_BYTES)
    }
  })

  it('recognises only its own members', () => {
    expect(isDiagramSourceKind('mermaid')).toBe(true)
    expect(isDiagramSourceKind('graphviz')).toBe(false)
    expect(isDiagramSourceKind(null)).toBe(false)
  })
})

describe('the producer tuple grew, and grew by two', () => {
  it('carries the diagram producers beside the first one, as TWO members', () => {
    expect([...GENERATED_DOCUMENT_PRODUCERS]).toContain('diagram_svg')
    expect([...GENERATED_DOCUMENT_PRODUCERS]).toContain('diagram_pdf')
    expect([...GENERATED_DOCUMENT_PRODUCERS]).not.toContain('diagram')
  })

  it('did not disturb the producer that was already there', () => {
    expect(GENERATED_DOCUMENT_PRODUCERS[0]).toBe('deep_research')
  })
})

describe('every refusal can be read, in both locales', () => {
  it('has English copy for every rejection', () => {
    const missing = DIAGRAM_SVG_REJECTIONS.filter((reason) => !diagramsCopy.messages.en.rejected[reason])
    expect(missing).toEqual([])
  })

  it('has German copy for every rejection', () => {
    const missing = DIAGRAM_SVG_REJECTIONS.filter((reason) => !diagramsCopy.messages.de.rejected[reason])
    expect(missing).toEqual([])
  })

  it('says something different in each locale, so neither is a copy of the other', () => {
    for (const reason of DIAGRAM_SVG_REJECTIONS) {
      expect(diagramsCopy.messages.de.rejected[reason]).not.toBe(diagramsCopy.messages.en.rejected[reason])
    }
  })

  it('marks the PDF in both locales, and says it claims no dimensions', () => {
    expect(diagramsCopy.messages.de.marking).toContain(`Von ${PRODUCT_NAME} erstellt`)
    expect(diagramsCopy.messages.de.marking).toContain('Schematisch')
    expect(diagramsCopy.messages.en.marking).toContain(`Created by ${PRODUCT_NAME}`)
    expect(diagramsCopy.messages.en.marking).toContain('Schematic')
    expect(diagramsCopy.messages.de.schematicOnly).toBe('Schematisch — ohne Maßangabe.')
  })
})

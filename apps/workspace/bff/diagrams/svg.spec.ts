/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_DIAGRAM_SVG_BYTES, MAX_DIAGRAM_SVG_DEPTH } from './diagram-sources'
import {
  DIAGRAM_SVG_REJECTIONS,
  DiagramSvgError,
  acceptDiagram,
  attributeOf,
  censusSvg,
  diagramSourceOf,
  parseDiagramSvg,
  serializeDiagramSvg,
  withDiagramMarking,
} from './svg'

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'

const MARKING = { notice: 'a machine drew this', provenance: 'MARK=yes' }

function nested(depth: number): string {
  const groups = depth - 2
  return `${OPEN}${'<g>'.repeat(groups)}<rect width="1" height="1"/>${'</g>'.repeat(groups)}</svg>`
}

function rejection(svg: string): string {
  try {
    parseDiagramSvg(svg)
  } catch (error) {
    if (error instanceof DiagramSvgError) return error.rejection
    throw error
  }
  throw new Error('expected a rejection, and the parser accepted it')
}

describe('what is refused, by name', () => {
  it('refuses nothing at all', () => {
    expect(rejection('')).toBe('empty')
  })

  it('refuses more bytes than the budget', () => {
    const filler = 'a'.repeat(MAX_DIAGRAM_SVG_BYTES)
    expect(rejection(`${OPEN}<desc>${filler}</desc></svg>`)).toBe('too-large')
  })

  it('refuses a script', () => {
    expect(rejection(`${OPEN}<script>alert(1)</script></svg>`)).toBe('script-element')
  })

  it('refuses a script whatever its case', () => {
    expect(rejection(`${OPEN}<SCRIPT>alert(1)</SCRIPT></svg>`)).toBe('script-element')
  })

  it('refuses a foreignObject', () => {
    expect(rejection(`${OPEN}<foreignObject><b>hi</b></foreignObject></svg>`)).toBe('foreign-object')
  })

  it('refuses a stylesheet', () => {
    expect(rejection(`${OPEN}<style>.a{fill:red}</style></svg>`)).toBe('style-element')
  })

  it('refuses an event handler', () => {
    expect(rejection(`${OPEN}<rect width="1" height="1" onload="alert(1)"/></svg>`)).toBe(
      'event-handler-attribute',
    )
  })

  it('refuses an external href', () => {
    expect(rejection(`${OPEN}<a href="https://evil.example"><rect width="1" height="1"/></a></svg>`)).toBe(
      'external-reference',
    )
  })

  it('refuses an external xlink:href', () => {
    expect(rejection(`${OPEN}<rect width="1" height="1" xlink:href="//evil.example"/></svg>`)).toBe(
      'external-reference',
    )
  })

  it('allows a fragment href, which is the only reference a self-contained file makes', () => {
    expect(() => parseDiagramSvg(`${OPEN}<rect width="1" height="1" clip-path="url(#c)"/></svg>`)).not.toThrow()
  })

  it('refuses an external url() inside an attribute value', () => {
    expect(rejection(`${OPEN}<rect width="1" height="1" fill="url(https://evil.example/x)"/></svg>`)).toBe(
      'external-reference',
    )
  })

  it('refuses a javascript: value', () => {
    expect(rejection(`${OPEN}<rect width="1" height="1" fill="javascript:alert(1)"/></svg>`)).toBe(
      'external-reference',
    )
  })

  it('refuses an external url() smuggled through a style attribute', () => {
    expect(rejection(`${OPEN}<rect width="1" height="1" style="fill:url(https://evil.example/x)"/></svg>`)).toBe(
      'external-reference',
    )
  })

  it('refuses a DOCTYPE, which is what makes XXE unrepresentable', () => {
    expect(rejection('<!DOCTYPE svg SYSTEM "http://evil.example/x.dtd">' + OPEN + '</svg>')).toBe(
      'doctype-or-entity',
    )
  })

  it('refuses an entity declaration, which is what makes billion-laughs unrepresentable', () => {
    expect(rejection('<!ENTITY lol "lol">' + OPEN + '</svg>')).toBe('doctype-or-entity')
  })

  it('refuses an entity reference nothing defines', () => {
    expect(rejection(`${OPEN}<desc>&lol;</desc></svg>`)).toBe('malformed-xml')
  })

  it('refuses a mismatched closing tag', () => {
    expect(rejection(`${OPEN}<g></rect></svg>`)).toBe('malformed-xml')
  })

  it('refuses an unclosed element', () => {
    expect(rejection(`${OPEN}<g>`)).toBe('malformed-xml')
  })

  it('refuses an unquoted attribute value', () => {
    expect(rejection('<svg viewBox=0 0 100 50></svg>')).toBe('malformed-xml')
  })

  it('refuses content after the root element', () => {
    expect(rejection(`${OPEN}</svg><svg/>`)).toBe('malformed-xml')
  })

  it('refuses a root that is not an svg', () => {
    expect(rejection('<html><body/></html>')).toBe('not-svg')
  })

  it('refuses an element it does not draw, rather than dropping it', () => {
    expect(rejection(`${OPEN}<image width="1" height="1"/></svg>`)).toBe('unsupported-element')
  })

  it('refuses a diagram with no viewport', () => {
    expect(rejection('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toBe(
      'missing-viewport',
    )
  })

  it('accepts a sizeless viewBox-less svg that states width and height', () => {
    expect(parseDiagramSvg('<svg width="80" height="40"><rect width="1" height="1"/></svg>').viewport).toEqual({
      width: 80,
      height: 40,
      viewBox: '0 0 80 40',
    })
  })

  it('refuses a source longer than its kind allows', () => {
    expect(() =>
      acceptDiagram(
        { svg: `${OPEN}</svg>`, sourceKind: 'mermaid', source: 'x'.repeat(64 * 1024) },
        MARKING,
      ),
    ).toThrow(/source-too-large/)
  })

  it('refuses a tree nested past the depth bound', () => {
    expect(rejection(nested(MAX_DIAGRAM_SVG_DEPTH + 1))).toBe('too-deep')
  })

  it('accepts a tree exactly at the bound, so the bound is where it says it is', () => {
    expect(() => parseDiagramSvg(nested(MAX_DIAGRAM_SVG_DEPTH))).not.toThrow()
  })

  it('refuses a depth no byte cap would ever catch, by name rather than by RangeError', () => {
    const svg = nested(5000)
    expect(new TextEncoder().encode(svg).byteLength).toBeLessThan(MAX_DIAGRAM_SVG_BYTES)
    expect(rejection(svg)).toBe('too-deep')
  })

  it('refuses a metadata block anywhere but the root', () => {
    expect(
      rejection(`${OPEN}<g><metadata data-grid-diagram-source="mermaid">x</metadata></g></svg>`),
    ).toBe('unsupported-element')
  })

  it('has a case for every declared rejection', () => {
    const covered = new Set([
      'empty',
      'too-large',
      'malformed-xml',
      'doctype-or-entity',
      'not-svg',
      'missing-viewport',
      'script-element',
      'foreign-object',
      'style-element',
      'unsupported-element',
      'event-handler-attribute',
      'external-reference',
      'source-too-large',
      'too-deep',
    ])
    expect([...DIAGRAM_SVG_REJECTIONS].filter((member) => !covered.has(member))).toEqual([])
  })
})

describe('what is stored is written here, not copied from the request', () => {
  it('drops an attribute it does not know, without refusing the diagram', () => {
    const { root } = parseDiagramSvg(
      `${OPEN}<rect width="10" height="10" fill="#eee" data-mermaid="x" aria-label="y"/></svg>`,
    )
    const stored = serializeDiagramSvg(root)
    expect(stored).toContain('fill="#eee"')
    expect(stored).not.toContain('data-mermaid')
    expect(stored).not.toContain('aria-label')
  })

  it('flattens a style attribute into real attributes', () => {
    const { root } = parseDiagramSvg(`${OPEN}<rect width="10" height="10" style="fill:#123456;stroke-width:2"/></svg>`)
    const stored = serializeDiagramSvg(root)
    expect(stored).toContain('fill="#123456"')
    expect(stored).toContain('stroke-width="2"')
    expect(stored).not.toContain('style=')
  })

  it('lets a style declaration beat the attribute it collides with, exactly once', () => {
    const { root } = parseDiagramSvg(`${OPEN}<rect width="1" height="1" fill="red" style="fill:blue"/></svg>`)
    const stored = serializeDiagramSvg(root)
    expect(stored.match(/fill=/g)).toHaveLength(1)
    expect(stored).toContain('fill="blue"')
  })

  it('adds the namespace a standalone .svg file needs', () => {
    const { root } = parseDiagramSvg('<svg viewBox="0 0 10 10"><rect width="1" height="1"/></svg>')
    expect(serializeDiagramSvg(root)).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('escapes text rather than carrying it through', () => {
    const { root } = parseDiagramSvg(`${OPEN}<text x="0" y="0">&lt;b&gt;&amp;</text></svg>`)
    const stored = serializeDiagramSvg(root)
    expect(stored).toContain('&lt;b&gt;&amp;')
    expect(stored).not.toContain('<b>')
  })
})

describe('the diagram carries its own source', () => {
  const submission = {
    svg: `${OPEN}<rect width="10" height="10"/></svg>`,
    sourceKind: 'mermaid' as const,
    source: 'graph TD\n  A --> B & "C"',
  }

  it('files the source inside the file, so it travels with the drawing', () => {
    const accepted = acceptDiagram(submission, MARKING)
    expect(diagramSourceOf(accepted.root)).toEqual({ kind: 'mermaid', source: submission.source })
    expect(acceptDiagram(submission, MARKING).svg).toContain('<metadata data-grid-diagram-source="mermaid">')
  })

  it('survives a round trip through the parser it will be read back with', () => {
    const stored = acceptDiagram(submission, MARKING).svg
    expect(diagramSourceOf(parseDiagramSvg(stored).root)?.source).toBe(submission.source)
  })

  it('discards a metadata block the client sent and records its own', () => {
    const accepted = acceptDiagram(
      {
        ...submission,
        svg: `${OPEN}<metadata data-grid-diagram-source="mermaid">a lie</metadata><rect width="1" height="1"/></svg>`,
      },
      MARKING,
    )
    expect(accepted.svg).not.toContain('a lie')
    expect(diagramSourceOf(accepted.root)?.source).toBe(submission.source)
  })

  it('refuses a nested metadata rather than filing the source inside it', () => {
    const decoy = 'x'.repeat(200 * 1024)
    expect(() =>
      acceptDiagram(
        {
          ...submission,
          svg: `${OPEN}<g><metadata data-grid-diagram-source="mermaid">${decoy}</metadata></g></svg>`,
        },
        MARKING,
      ),
    ).toThrow(/unsupported-element/)
  })

  it('stores exactly one source, so nothing downstream has to pick', () => {
    const accepted = acceptDiagram(
      {
        ...submission,
        svg: `${OPEN}<metadata data-grid-diagram-source="mermaid">a lie</metadata><rect width="1" height="1"/></svg>`,
      },
      MARKING,
    )
    expect(accepted.svg.match(/data-grid-diagram-source/g)).toHaveLength(1)
  })

  it('reads the viewport off the root, for the page the PDF has to fit', () => {
    const accepted = acceptDiagram(submission, MARKING)
    expect(accepted.viewport).toEqual({ width: 100, height: 50, viewBox: '0 0 100 50' })
    expect(attributeOf(accepted.root, 'viewBox')).toBe('0 0 100 50')
  })
})

describe('the stored diagram says a machine drew it', () => {
  const submission = {
    svg: `${OPEN}<rect width="10" height="10"/></svg>`,
    sourceKind: 'mermaid' as const,
    source: 'graph TD\n  A --> B',
  }

  it('survives the allow-list it is written back out through', () => {
    const stored = acceptDiagram(submission, MARKING).svg
    expect(stored).toContain('<title>a machine drew this</title>')
    expect(stored).toContain('<desc>MARK=yes</desc>')
  })

  it('is still there after the parser it will be read back with', () => {
    const stored = acceptDiagram(submission, MARKING).svg
    const { root } = parseDiagramSvg(stored)
    expect(serializeDiagramSvg(root)).toContain('<title>a machine drew this</title>')
  })

  it('names the file before anything else, because the first title is the name', () => {
    const marked = withDiagramMarking(parseDiagramSvg(`${OPEN}<rect width="1" height="1"/></svg>`).root, MARKING)
    expect(marked.children[0]).toMatchObject({ name: 'title' })
    expect(marked.children[1]).toMatchObject({ name: 'desc' })
  })

  it('replaces what the client said about the file, and not what it said inside it', () => {
    const accepted = acceptDiagram(
      {
        ...submission,
        svg: `${OPEN}<title>a person drew this</title><desc>honest</desc><g><title>Einreichung</title><rect width="1" height="1"/></g></svg>`,
      },
      MARKING,
    )
    expect(accepted.svg).not.toContain('a person drew this')
    expect(accepted.svg).not.toContain('<desc>honest</desc>')
    expect(accepted.svg).toContain('<title>Einreichung</title>')
  })

  it('escapes a marking rather than letting it close a tag', () => {
    const accepted = acceptDiagram(submission, {
      notice: '</title><script>x()</script>',
      provenance: 'MARK=yes',
    })
    expect(accepted.svg).not.toContain('<script>')
    expect(accepted.svg).toContain('&lt;/title&gt;')
  })

  it('leaves the tree the PDF redraws unmarked', () => {
    const accepted = acceptDiagram(submission, MARKING)
    expect(accepted.root.children.some((child) => child.kind === 'element' && child.name === 'title')).toBe(false)
  })
})

describe('censusSvg', () => {
  it('counts nodes, tags and depth without carrying any text', () => {
    const { root } = parseDiagramSvg(
      `${OPEN}<g><rect width="1" height="1"/><text>Fluchtweg</text></g></svg>`
    )

    expect(censusSvg(root)).toEqual({
      nodes: 5,
      elements: 4,
      textChars: 'Fluchtweg'.length,
      depth: 4,
      tags: { svg: 1, g: 1, rect: 1, text: 1 },
    })
  })
})

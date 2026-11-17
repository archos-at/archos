/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { markdownToBlocks } from './markdown'
import type { DocBlock } from './blocks'

const runsText = (block: DocBlock): string =>
  block.kind === 'paragraph' ? block.runs.map((r) => r.text).join('') : ''

describe('markdownToBlocks — diagram fences', () => {
  it('labels a mermaid fence and keeps its source', () => {
    const blocks = markdownToBlocks('```mermaid\ngraph TD; A-->B\n```')

    expect(blocks).toHaveLength(2)
    expect(runsText(blocks[0])).toContain('Diagramm')
    expect(runsText(blocks[0])).toContain('mermaid')
    expect(runsText(blocks[1])).toBe('graph TD; A-->B')

    expect(blocks[1].kind === 'paragraph' && blocks[1].runs[0].mono).toBe(true)
    expect(blocks[0].kind === 'paragraph' && blocks[0].runs[0].mono).toBeFalsy()
  })

  it.each(['excalidraw', 'excalidraw-refused'])('prints a %s sketch as its label alone, never its JSON', (lang) => {
    const blocks = markdownToBlocks(`\`\`\`${lang}\n{"elements": [{"type": "text", "x": 0, "y": 0, "text": "N"}]}\n\`\`\``)

    expect(blocks).toHaveLength(1)
    expect(runsText(blocks[0])).toContain('Skizze')
    expect(runsText(blocks[0])).not.toContain('{')
  })

  it('leaves an ordinary code fence exactly as it was', () => {
    const blocks = markdownToBlocks('```ts\nconst a = 1\n```')

    expect(blocks).toHaveLength(1)
    expect(runsText(blocks[0])).toBe('const a = 1')
  })

  it('labels every kind the product knows how to draw', () => {
    for (const [lang, word] of [['mermaid', 'mermaid'], ['excalidraw', 'Skizze']]) {
      const blocks = markdownToBlocks('```' + lang + '\nx\n```')
      expect(runsText(blocks[0])).toContain(word)
    }
  })

  it('is not fooled by case or padding in the fence info string', () => {
    const blocks = markdownToBlocks('```  MERMAID  \ngraph TD; A-->B\n```')
    expect(blocks).toHaveLength(2)
    expect(runsText(blocks[0])).toContain('Diagramm')
  })

  it('treats a bare fence as code, not as a drawing', () => {
    const blocks = markdownToBlocks('```\nplain\n```')
    expect(blocks).toHaveLength(1)
  })
})

describe('markdownToBlocks — the answer dialect', () => {
  it('prints a check as its table, a details block open, and an energy class as its letter', () => {
    const blocks = markdownToBlocks(
      [
        ':::check',
        '| Anforderung | Ist | Soll |',
        '|---|---|---|',
        '| Trittschall | 57 dB | ≥ 55 dB |',
        ':::',
        '',
        ':::details[Herleitung]',
        'Klasse :energy-class[B] laut Energieausweis.',
        ':::',
      ].join('\n')
    )
    expect(blocks[0]).toMatchObject({ kind: 'table', head: ['Anforderung', 'Ist', 'Soll'] })
    const text = blocks.map((block) => (block.kind === 'paragraph' ? block.runs.map((run) => run.text).join('') : '')).join('\n')
    expect(text).toContain('Herleitung')
    expect(text).toContain('Klasse B laut Energieausweis.')
    expect(text).not.toContain(':::')
  })
})

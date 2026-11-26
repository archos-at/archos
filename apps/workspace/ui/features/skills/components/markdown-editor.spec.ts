// @disk-inputs: ui/features/skills/components/markdown-editor.css
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type AtRule, type Container, type Declaration } from 'postcss'
import { describe, expect, test } from 'vitest'

const css = postcss.parse(readFileSync(join(__dirname, 'markdown-editor.css'), 'utf8'))

const coarseBlocks = (): AtRule[] => {
  const blocks: AtRule[] = []
  css.walkAtRules('media', (media) => {
    if (media.params === '(pointer: coarse)') blocks.push(media)
  })
  return blocks
}

const declarationsIn = (container: Container): Declaration[] => {
  const declarations: Declaration[] = []
  container.walkDecls((declaration) => {
    declarations.push(declaration)
  })
  return declarations
}

const holds = (container: Container, prop: string, value: string): boolean =>
  declarationsIn(container).some((declaration) => declaration.prop === prop && declaration.value === value)

const coarseBlockWith = (prop: string, value: string): AtRule | undefined =>
  coarseBlocks().find((block) => holds(block, prop, value))

describe('markdown-editor.css', () => {
  test('source text is 16px where a finger types', () => {
    const block = coarseBlockWith('font-size', '16px')
    const selectors = (block?.nodes ?? []).flatMap((node) => (node.type === 'rule' ? node.selectors : []))
    expect(selectors.some((selector) => selector.endsWith('.w-md-editor-text-pre > code'))).toBe(true)
  })

  test('toolbar buttons reach the 44px floor and scroll in one row', () => {
    const block = coarseBlockWith('height', '44px')
    expect(block && holds(block, 'min-width', '44px')).toBe(true)
    expect(block && holds(block, 'flex-wrap', 'nowrap')).toBe(true)
    expect(block && holds(block, 'overflow-x', 'auto')).toBe(true)
  })
})

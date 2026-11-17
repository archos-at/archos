// @disk-inputs: ui/features/skills/components/markdown-editor.css
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const css = readFileSync(join(__dirname, 'markdown-editor.css'), 'utf8')

const coarseBlockWith = (needle: string): string => {
  for (const match of css.matchAll(/@media \(pointer: coarse\) \{/g)) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1
      else if (css[end] === '}' && --depth === 0) break
    }
    const block = css.slice(match.index, end + 1)
    if (block.includes(needle)) return block
  }
  return ''
}

describe('markdown-editor.css', () => {
  test('source text is 16px where a finger types', () => {
    expect(coarseBlockWith('font-size: 16px')).toMatch(/\.w-md-editor-text-pre > code/)
  })

  test('toolbar buttons reach the 44px floor and scroll in one row', () => {
    const block = coarseBlockWith('height: 44px')
    expect(block).toMatch(/min-width: 44px/)
    expect(block).toMatch(/flex-wrap: nowrap/)
    expect(block).toMatch(/overflow-x: auto/)
  })
})

import { render } from '@/test-utils'
import { describe, expect, it, vi } from 'vitest'

const parses = vi.hoisted(() => [] as string[])
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>()
  const Counted = (props: Parameters<typeof actual.default>[0]) => {
    parses.push(String(props.children))
    return actual.default(props)
  }
  return { ...actual, default: Counted }
})

import { MarkdownRenderer } from './MarkdownRenderer'
import { MIN_BLOCK_CHARS, splitMarkdownBlocks } from './markdown-blocks'

const paragraph = (opening: string) =>
  `${opening} ${'Die Fluchtweglänge beträgt nach OIB-Richtlinie 2 höchstens 40 m. '.repeat(Math.ceil(MIN_BLOCK_CHARS / 60))}`

const TABLE = [
  '| Kriterium | Status |',
  '|---|---|',
  '| Stützen | erfüllt |',
  '| Decke | erfüllt |',
  '| Wände | nicht erfüllt |',
].join('\n')

const ANSWER = [paragraph('Zuerst'), TABLE, paragraph('Danach'), paragraph('Zuletzt')].join('\n\n')

describe('the settle of a streamed text', () => {
  it('parses no block but the last again', () => {
    expect(splitMarkdownBlocks(ANSWER)!.length).toBeGreaterThan(2)
    const { rerender } = render(<MarkdownRenderer content={ANSWER} isStreaming />)
    parses.length = 0
    rerender(<MarkdownRenderer content={ANSWER} />)
    expect(parses.map((source) => source.split(' ')[0])).toEqual(['Zuletzt'])
  })

  it('still updates what reads the stream state, in a block it did not parse', () => {
    const marks = () => [...document.querySelectorAll('[data-testid="status-mark"]')]
    const { rerender } = render(<MarkdownRenderer content={ANSWER} isStreaming />)
    expect(marks().length).toBeGreaterThan(0)
    expect(marks().every((mark) => mark.className.includes('animate-in'))).toBe(true)

    parses.length = 0
    rerender(<MarkdownRenderer content={ANSWER} />)
    expect(parses.some((source) => source.includes('| Kriterium'))).toBe(false)
    expect(marks().some((mark) => mark.className.includes('animate-in'))).toBe(false)
  })
})

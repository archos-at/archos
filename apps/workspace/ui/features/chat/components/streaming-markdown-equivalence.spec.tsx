import { describe, expect, it, vi } from 'vitest'
import type { PluggableList } from 'unified'
import { render } from '@/test-utils'
import { STREAM_FRAMES } from '@/app/dev/_fixtures/stream-frames'
import { MIN_BLOCK_CHARS, type MarkdownBlock } from '@/shared/components/MarkdownRenderer/markdown-blocks'

type Split = (markdown: string, minChars?: number) => MarkdownBlock[] | null
const splitter = vi.hoisted(() => ({ current: null as Split | null, real: null as Split | null }))

vi.mock('@/shared/components/MarkdownRenderer/markdown-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/MarkdownRenderer/markdown-blocks')>()
  splitter.real = actual.splitMarkdownBlocks
  return {
    ...actual,
    splitMarkdownBlocks: (markdown: string, minChars?: number) =>
      (splitter.current ?? actual.splitMarkdownBlocks)(markdown, minChars),
  }
})

import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { remarkCitationMarkers } from '@/features/layout/lib/citation-markers'
import { remarkCardMarkers } from '@/features/cards/card-markers'
import { remarkFileReferences } from '@/features/layout/lib/file-reference-markers'
import { splitAnswerBody } from '../lib/citations/views'

interface Step {
  body: string
  numbers: ReadonlySet<number>
  cards: number
  callout: boolean
  streaming: boolean
}

const stepKey = (step: Step): string =>
  JSON.stringify([step.body, [...step.numbers], step.cards, step.callout, step.streaming])

const RUN_STRIDE = 8
const EVERY_PREFIX = process.env.STREAM_EQUIVALENCE_EVERY_PREFIX === '1'
const PLAIN = /[\p{L}\p{N} ]/u
function telling(text: string, length: number): boolean {
  if (EVERY_PREFIX || length === 0 || length === text.length || length % RUN_STRIDE === 0) return true
  return !PLAIN.test(text[length - 1]) || !PLAIN.test(text[length - 2] ?? '\n') || !PLAIN.test(text[length])
}

function recordedSteps(name: keyof typeof STREAM_FRAMES): Step[] {
  const steps = new Map<string, Step>()
  const add = (step: Step) => steps.set(stepKey(step), step)
  let text = ''
  let cards = 0
  let callout = false
  for (const frame of STREAM_FRAMES[name].frames) {
    const done = frame.status === 'complete'
    text = done || frame.stream_replace ? frame.content : text + frame.content
    if (Array.isArray(frame.cards)) cards = frame.cards.length
    if (frame.answer_meta !== undefined) callout = Boolean((frame.answer_meta as { callout?: unknown } | null)?.callout)
    const lengths = done ? [text.length] : Array.from({ length: text.length + 1 }, (_, i) => i).filter((i) => telling(text, i))
    for (const length of lengths) {
      const { body, numbers } = splitAnswerBody(text.slice(0, length))
      add({ body, numbers, cards, callout, streaming: !done })
    }
  }
  return [...steps.values()]
}

const CORPUS = [
  'Intro\n\n- a\n\n- b\n  more\n\n  indented para\n\nAfter.\n',
  'Text\n\n```ts\nconst a = 1\n\n\nconst b = 2\n```\n\nAfter\n\n~~~\nx\n\n~~~\n\nEnd',
  'Titel\n---\n\nAbsatz\n\n---\n\nZweiter\n===\n\nDrei',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\n| c |\n|---|\n| 3 |\n\nText',
  'Satz[^1].\n\n[^1]: Fußnote.\n\nMehr.',
  'Mehr [x] und [1].\n\n[x]: https://example.com\n\nEnde',
  '## Bewertung\n\nText\n\n## Bewertung\n\n### Bewertung 2\n\n## Bewertung 2\n\nSchluss',
  'Formel:\n\n$$\na = b\n\nc\n$$\n\nInline $x$.',
  '> Zitat\n\n> zweites\n\nText',
  '[[callout]]\n\nText [1] mit [[card:1]]\n\n[[card:1]]\n\n[[card:9]]\n\nAbsatz [[ca\n\nEnde [[ca',
  '[[card:5]]\n\nText **fett\n\nMehr',
  '<!--\n\nx\n\n-->\n\nText',
  'Text\n\n    code\n\n    more\n\nEnd',
  '1. a\n\n2. b\n\nText\n\n3. c',
  '- item\n\n  ```\n  a\n\n  b\n  ```\n\nText',
]

function corpusSteps(): Step[] {
  const steps: Step[] = []
  for (const text of CORPUS) {
    for (const callout of [false, true]) {
      for (let length = 0; length <= text.length; length++) {
        steps.push({ body: text.slice(0, length), numbers: new Set([1]), cards: 1, callout, streaming: true })
      }
      steps.push({ body: text, numbers: new Set([1]), cards: 1, callout, streaming: false })
      steps.push({ body: text, numbers: new Set(), cards: 0, callout, streaming: false })
    }
  }
  return steps
}

const pluginsFor = (step: Step): PluggableList => [
  [remarkCitationMarkers, { numbers: step.numbers, anchorPrefix: 'answer-src-', pending: step.streaming }],
  [remarkCardMarkers, { count: step.cards, callout: step.callout, pending: step.streaming }],
  [remarkFileReferences, { fileNames: [] }],
]

function firstMismatch(
  steps: readonly Step[],
  ...splits: Split[]
): { body: string; blocks: string; whole: string } | null {
  const view = (step: Step, plugins: PluggableList) => (
    <MarkdownRenderer content={step.body} isStreaming={step.streaming} remarkPlugins={plugins} compact />
  )
  const renderers = splits.map((split) => ({ split, blocks: render(<div />) }))
  const whole = render(<div />)
  try {
    let plugins: PluggableList = []
    let pluginsKey = ''
    for (const step of steps) {
      const key = stepKey({ ...step, body: '' })
      if (key !== pluginsKey) [plugins, pluginsKey] = [pluginsFor(step), key]
      splitter.current = () => null
      whole.rerender(view(step, plugins))
      for (const { split, blocks } of renderers) {
        splitter.current = split
        blocks.rerender(view(step, plugins))
        if (blocks.container.innerHTML !== whole.container.innerHTML) {
          return { body: step.body, blocks: blocks.container.innerHTML, whole: whole.container.innerHTML }
        }
      }
    }
    return null
  } finally {
    splitter.current = null
    for (const { blocks } of renderers) blocks.unmount()
    whole.unmount()
  }
}

const naiveSplit: Split = (markdown) => {
  const blocks: MarkdownBlock[] = []
  let line = 0
  for (const source of markdown.split('\n\n')) {
    blocks.push({ source, line })
    line += source.split('\n').length + 1
  }
  return blocks
}

const lineSplit: Split = (markdown) => markdown.split('\n').map((source, line) => ({ source, line }))

const splitMarkdownBlocks: Split = (markdown) => splitter.real!(markdown)
const everyCut: Split = (markdown) => splitter.real!(markdown, 0)

const RECORDED = Object.keys(STREAM_FRAMES) as (keyof typeof STREAM_FRAMES)[]

describe('the streamed answer rendered block by block', () => {
  it.each(RECORDED)('renders every telling prefix of the recorded %s answer as the whole text does', (name) => {
    expect(firstMismatch(recordedSteps(name), everyCut, splitMarkdownBlocks)).toBeNull()
  }, 300_000)

  it('renders every prefix of the constructs that reach across blocks as the whole text does', () => {
    expect(firstMismatch(corpusSteps(), everyCut)).toBeNull()
  }, 60_000)

  it.each(RECORDED)('cuts the recorded %s answer, so the checks above are not vacuous', (name) => {
    const terminal = STREAM_FRAMES[name].frames.at(-1)!.content
    expect(everyCut(splitAnswerBody(terminal).body)?.length).toBeGreaterThan(1)
  })

  it('splits a recorded answer longer than a block at the default size', () => {
    const terminal = STREAM_FRAMES.varianten.frames.at(-1)!.content
    expect(splitMarkdownBlocks(splitAnswerBody(terminal).body)?.length).toBeGreaterThan(1)
  })

  it.each(RECORDED)('keeps every cut in the recorded %s answer where it is while the text grows', (name) => {
    const terminal = splitAnswerBody(STREAM_FRAMES[name].frames.at(-1)!.content).body
    for (const split of [everyCut, splitMarkdownBlocks]) {
      let finished: MarkdownBlock[] = []
      for (let length = 0; length <= terminal.length; length++) {
        const blocks = split(terminal.slice(0, length)) ?? []
        expect(blocks.slice(0, finished.length)).toEqual(finished)
        finished = blocks.slice(0, -1)
      }
    }
  })

  it('catches a split that treats Markdown as block-local', () => {
    expect(firstMismatch(corpusSteps(), naiveSplit)).not.toBeNull()
  }, 60_000)

  it('catches a split that cuts inside a block of a recorded answer', () => {
    expect(firstMismatch(recordedSteps('varianten'), lineSplit)).not.toBeNull()
  }, 60_000)
})

describe('a reveal step', () => {
  it('parses only the block that grew', () => {
    let parses = 0
    const counting: PluggableList = [() => () => void (parses += 1)]
    const long = ' Satz'.repeat(MIN_BLOCK_CHARS / 5)
    const blocks = [
      `## Erstens\n\n${long}`,
      `Ein Absatz.${long}`,
      `| a | b |\n|---|---|${'\n| 1 | 2 |'.repeat(MIN_BLOCK_CHARS / 10)}`,
      'Der letzte',
    ]
    const { rerender } = render(<MarkdownRenderer content={blocks.join('\n\n')} isStreaming remarkPlugins={counting} />)
    expect(parses).toBe(blocks.length)
    parses = 0
    rerender(<MarkdownRenderer content={`${blocks.join('\n\n')} Absatz wächst`} isStreaming remarkPlugins={counting} />)
    expect(parses).toBe(1)
  })

  it.each(RECORDED)('keeps the DOM nodes of the recorded %s answer that are already shown', (name) => {
    const { body } = splitAnswerBody(STREAM_FRAMES[name].frames.at(-1)!.content)
    const words = /(?<= )[\p{L}\p{N},.;:-]+ [\p{L}\p{N},.;:-]+ [\p{L}\p{N},.;:-]+ /gu
    const match = [...body.matchAll(words)].find((m) => m.index! > body.length / 2)!
    const start = match.index!
    const steps = [...match[0].matchAll(/ /g)].map((space) => start + space.index! + 1)
    const view = (length: number) => <MarkdownRenderer content={body.slice(0, length)} isStreaming compact />
    const { container, rerender } = render(view(start))
    const walker = document.createTreeWalker(container.querySelector('.markdown-content')!)
    const shown: Node[] = []
    while (walker.nextNode()) shown.push(walker.currentNode)
    expect(shown.length).toBeGreaterThan(3)
    for (const step of steps) {
      rerender(view(step))
      for (const node of shown) expect(node.isConnected).toBe(true)
    }
  })
})

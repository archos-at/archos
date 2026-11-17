import type { Root as HastRoot } from 'hast'
import { directiveDepths } from '@/lib/text/answer-directives'
import { closesCodeFence, openingCodeFence, type CodeFence, type CodeFenceOptions } from '@/lib/text/code-fence'


// 2026-09, phone at 4x CPU throttle: re-parsing the whole shown answer every 50 ms cost 17 ms per render, about 100 ms of parsing per second.
export interface MarkdownBlock {
  source: string
  line: number
}

const TOP_LEVEL: CodeFenceOptions = { math: true, maxIndent: 3 }
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const BLANK = /^[ \t]*$/
const CROSS_BLOCK = /\]:|\[\^|^[ \t>]*<|\r/m

const openingFence = (line: string): CodeFence | null => openingCodeFence(line, TOP_LEVEL)
const closesFence = (line: string, fence: CodeFence): boolean => closesCodeFence(line, fence, TOP_LEVEL)

const startsOwnBlock = (line: string, previousHoldsList: boolean): boolean => {
  if (line[0] === ' ' || line[0] === '\t') return false
  return !(previousHoldsList && LIST_ITEM.test(line))
}

const onlyMarkers = (source: string): boolean => source.replace(/\[\[[^\]\n]*\]\]/g, '').trim() === ''

export const MIN_BLOCK_CHARS = 1200

export function splitMarkdownBlocks(markdown: string, minChars: number = MIN_BLOCK_CHARS): MarkdownBlock[] | null {
  if (CROSS_BLOCK.test(markdown)) return null
  const lines = markdown.split('\n')
  const blocks: MarkdownBlock[] = []
  let start = -1
  let end = -1
  let size = 0
  let gap = false
  let holdsList = false
  let fence: CodeFence | null = null
  const depths = directiveDepths(lines)

  lines.forEach((line, index) => {
    size += line.length + 1
    if (fence) {
      if (closesFence(line, fence)) fence = null
      end = index + 1
      return
    }
    if (depths[index] > 0) {
      end = index + 1
      return
    }
    if (BLANK.test(line)) {
      gap = start >= 0
      return
    }
    if (start < 0) start = index
    else if (gap && size >= minChars && startsOwnBlock(line, holdsList)) {
      blocks.push({ source: lines.slice(start, end).join('\n'), line: start })
      start = index
      size = line.length + 1
      holdsList = false
    }
    gap = false
    end = index + 1
    if (LIST_ITEM.test(line)) holdsList = true
    fence = openingFence(line)
  })
  if (start >= 0) blocks.push({ source: lines.slice(start).join('\n'), line: start })

  while (blocks.length > 1 && onlyMarkers(blocks[0].source)) {
    const [first, second] = blocks
    const between = lines.slice(first.line, second.line).join('\n')
    blocks.splice(0, 2, { source: `${between}\n${second.source}`, line: first.line })
  }
  return blocks
}

const CONTINUES = 'markdownBlockContinues'

interface FileWithData {
  data: Record<string, unknown>
}

export const remarkBlockContinues = () => (_tree: unknown, file: FileWithData) => {
  file.data[CONTINUES] = true
}

export const documentContinues = (file: FileWithData | undefined): boolean => file?.data[CONTINUES] === true

export const rehypeBlockSeparator = () => (tree: HastRoot) => {
  if (tree.children.length > 0) tree.children.unshift({ type: 'text', value: '\n' })
}

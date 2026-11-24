import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import { rehypeBindWords } from './bind-words'
import { rehypeDirectiveShape } from './directive-shape'
import { rehypeBlockSeparator } from './markdown-blocks'
import { rehypeStreamingCaret } from './streaming-caret'
import { rehypeTableShape } from './table-shape'

const KATEX_OPTIONS = { throwOnError: false, maxSize: 20, maxExpand: 200 }
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, KATEX_OPTIONS], rehypeTableShape, rehypeDirectiveShape, rehypeBindWords]
const REHYPE_PLUGINS_OPEN: PluggableList = [
  [rehypeKatex, KATEX_OPTIONS],
  [rehypeTableShape, { openTail: true }],
  [rehypeDirectiveShape, { openTail: true }],
  rehypeBindWords,
]

const REHYPE_PLUGINS_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS, rehypeBlockSeparator]
const REHYPE_PLUGINS_OPEN_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS_OPEN, rehypeBlockSeparator]
const REHYPE_PLUGINS_CARET: PluggableList = [...REHYPE_PLUGINS_OPEN, rehypeStreamingCaret]
const REHYPE_PLUGINS_CARET_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS_OPEN_AFTER_FIRST, rehypeStreamingCaret]

export function rehypePluginsFor(first: boolean, open: boolean, caret: boolean): PluggableList {
  if (!open) return first ? REHYPE_PLUGINS : REHYPE_PLUGINS_AFTER_FIRST
  if (caret) return first ? REHYPE_PLUGINS_CARET : REHYPE_PLUGINS_CARET_AFTER_FIRST
  return first ? REHYPE_PLUGINS_OPEN : REHYPE_PLUGINS_OPEN_AFTER_FIRST
}

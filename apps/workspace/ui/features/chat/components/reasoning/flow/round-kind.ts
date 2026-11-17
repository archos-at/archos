import type { Translator } from '@/i18n'
import { type LinkSelection } from '../../../lib/work-list'

export const SPINE_FOLD_THRESHOLD = 3

export function defaultFoldedRounds(_count: number): Set<number> {
  return new Set()
}

const OPEN_TOOLS: ReadonlySet<string> = new Set(['read_file', 'read_passage'])

const toolBase = (tool: string): string =>
  tool
    .trim()
    .replace(/^tool:\s*/i, '')
    .toLowerCase()

const onlyOpened = (tools: string[]): boolean =>
  tools.length > 0 && tools.every((tool) => OPEN_TOOLS.has(toolBase(tool)))

const BROWSE_TOOLS: ReadonlySet<string> = new Set(['ls', 'glob', 'list_files'])

const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'knowledge_search',
  'grep',
  'read_file',
  'project_lookup',
  'read_passage',
  'surface_documents',
  'web_search_tool',
  'advanced_web_search_tool',
  'ris_search_tool',
  'ris_fetch_tool',
  'law_lookup',
  'ris_lookup_tool',
  'ris_catalog_lookup_tool',
])

const searchedNothing = (tools: string[]): boolean =>
  tools.length > 0 && !tools.some((tool) => SEARCH_TOOLS.has(toolBase(tool)))

export function roundKind(
  hasThought: boolean,
  documentCount: number,
  tools: string[],
  t: Translator,
  accounted = false
): string {
  if (
    documentCount === 0 &&
    tools.length > 0 &&
    tools.every((tool) => BROWSE_TOOLS.has(toolBase(tool)))
  ) {
    return t('thinking.node.stepKindBrowse')
  }
  if (documentCount === 0 && accounted && !searchedNothing(tools))
    return t('thinking.node.stepKindNoHits')
  if (documentCount > 0 && onlyOpened(tools)) return t('thinking.node.stepKindOpen')
  if (hasThought && documentCount > 0) return t('thinking.node.stepKindFinding')
  if (hasThought) return t('thinking.node.stepKindConclusion')
  if (documentCount > 0) return t('thinking.node.stepKindRead')
  return t('thinking.node.stepKindSearch')
}

export interface SpineFolding {
  folded: ReadonlySet<number>
  onToggle: (index: number) => void
}

export interface GraphInteraction {
  selection: LinkSelection | null
  onSelect: (selection: LinkSelection | null) => void
  openFolds: ReadonlySet<string>
  onToggleFold: (key: string) => void
}

export const NO_INTERACTION: GraphInteraction = {
  selection: null,
  onSelect: () => {},
  openFolds: new Set<string>(),
  onToggleFold: () => {},
}

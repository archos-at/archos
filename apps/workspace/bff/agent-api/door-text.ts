export interface ToolNames {
  readonly [pythonTool: string]: string
}

const CALLED = /`?\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\(([^()`]*)\)`?/g
const TICKED = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)*)`/g
const BARE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g

export function withOperationNames(text: string, names: ToolNames): string {
  const known = (tool: string): string | undefined => (Object.hasOwn(names, tool) ? names[tool] : undefined)
  return text
    .replace(CALLED, (match, tool: string, args: string) => {
      const op = known(tool)
      if (!op) return match
      const input = args.trim()
      return input ? `\`${op}\` with input {${input}}` : `\`${op}\``
    })
    .replace(TICKED, (match, tool: string) => {
      const op = known(tool)
      return op ? `\`${op}\`` : match
    })
    .replace(BARE, (match, tool: string) => known(tool) ?? match)
}

const COUNT_LINE = /^Found (\d+) (?:relevant )?document\(s\)([^\n]*)$/m

export function withRankedOrderNote(text: string, groupedByDocument = false): string {
  if (!COUNT_LINE.test(text)) return text
  const unit = groupedByDocument ? 'documents' : 'passages'
  const limit = groupedByDocument ? '' : ' The number of hits is the platform’s configured limit.'
  return text.replace(
    COUNT_LINE,
    `Found $1 ${unit}$2\n(Ranked hits are in the search’s final order, after reranking and the per-document spread. ` +
      `Each Relevance Score is that passage’s retrieval score, so it does not fall steadily down the list.${limit})`,
  )
}

export const HIT_TEXT_BUDGET = 38_000

const HIT_SPLIT = /(?=^--- Result \d+ ---$)/m
const CUT_NOTE = '\n… [cut to fit the answer; read the whole passage with `passage-read` by its Citation]'

export function fittedHits(text: string, budget: number = HIT_TEXT_BUDGET): string {
  if (text.length <= budget) return text
  const [head = '', ...hits] = text.split(HIT_SPLIT)
  if (hits.length === 0) return text
  const share = Math.floor((budget - head.length) / hits.length) - CUT_NOTE.length - 2
  if (share <= 0) return text
  return head + hits.map((hit) => (hit.length <= share ? hit : shortened(hit, share))).join('')
}

function shortened(hit: string, share: number): string {
  const blank = hit.indexOf('\n\n')
  const meta = blank === -1 ? '' : hit.slice(0, blank + 2)
  const body = blank === -1 ? hit : hit.slice(blank + 2)
  const room = Math.max(share - meta.length, 0)
  return body.length <= room ? hit : `${meta}${body.slice(0, room).trimEnd()}${CUT_NOTE}\n\n`
}

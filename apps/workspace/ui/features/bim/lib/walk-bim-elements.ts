import { BIM_ELEMENTS_PAGE_LIMIT } from '@/lib/bim/types'
import { getJson } from './async-request'
import type { BimViewerElement } from './model-index'

export async function walkBimElements(
  modelId: string,
  filter: Record<string, unknown>,
  signal: AbortSignal
): Promise<BimViewerElement[]> {
  const PAGE = BIM_ELEMENTS_PAGE_LIMIT
  const CONCURRENCY = 6

  const fetchPage = (offset: number) =>
    getJson<{ elements: BimViewerElement[]; total?: number; totalIsLowerBound?: boolean }>(
      `/api/bim/models/${modelId}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'elements', filter, limit: PAGE, offset }),
        signal,
      }
    )

  const first = await fetchPage(0)
  const collected = [...first.elements]
  if (first.elements.length < PAGE) return collected

  const known =
    typeof first.total === 'number' && first.totalIsLowerBound !== true
      ? Math.ceil(first.total / PAGE)
      : Infinity

  let offset = PAGE
  let done = false
  for (let round = 0; round < 80 && !done; round += 1) {
    const width = Math.min(CONCURRENCY, Math.max(1, known - offset / PAGE))
    if (width <= 0) break
    const offsets = Array.from({ length: width }, (_, index) => offset + index * PAGE)
    const pages = await Promise.all(offsets.map(fetchPage))
    for (const page of pages) {
      collected.push(...page.elements)
      if (page.elements.length < PAGE) done = true
    }
    offset += width * PAGE
    if (offset / PAGE >= known) done = true
  }
  return collected
}

'use client'

import type { JSX, ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

/** The query's words worth marking: three letters or more, escaped for a pattern. */
function queryWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((word) => word.length >= 3)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
}

/**
 * A passage with the query's words in ink at weight 500 inside the muted text: the reader sees why it matched
 * without reading the whole passage. A word is matched at its start, so „Fluchtweg“ also marks „Fluchtwegbreite“.
 */
export function MarkedSnippet({ text, query }: { text: string; query?: string | null }): JSX.Element {
  const words = query ? queryWords(query) : []
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${words.join('|')})`, 'giu')
  const parts: ReactNode[] = text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="bg-transparent font-medium text-foreground" data-testid="snippet-match">
        {part}
      </mark>
    ) : (
      part
    )
  )
  return <>{parts}</>
}

/**
 * Match evidence for a search result tile: the passage that matched, its marked words, and the page it came
 * from. The search ranks and shows no score (ADR-0136): the order of the tiles is the ranking. A document found
 * by its name or by what it is carries no passage, and then nothing is drawn. On the page under the name, in the
 * tile's own muted meta, no tinted box: a bordered blue-grey panel in every tile was a box in a tile.
 */
export function SemanticMatch({ snippet, page, query }: { snippet: string; page: number | null; query?: string | null }) {
  const t = useTranslations(filesCopy)
  if (snippet === '' && page === null) return null

  return (
    <div className="mt-1 space-y-0.5" data-testid="semantic-match">
      {snippet !== '' && (
        <p className="line-clamp-3 text-xs leading-normal text-muted-foreground" title={snippet}>
          <MarkedSnippet text={snippet} query={query} />
        </p>
      )}
      {page !== null && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums" data-testid="semantic-page">
            {t('browser.semantic.page', { page: String(page) })}
          </span>
        </p>
      )}
    </div>
  )
}

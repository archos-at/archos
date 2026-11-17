'use client'

import type { JSX, ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')

function queryWords(query: string): { words: string[]; stems: string[] } {
  const words = query
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((word) => word.length >= 3)
  return { words: words.map(escape), stems: words.filter((word) => word.length >= 10).map((word) => escape(word.slice(0, 6))) }
}

export function MarkedSnippet({ text, query }: { text: string; query?: string | null }): JSX.Element {
  const { words, stems } = query ? queryWords(query) : { words: [], stems: [] }
  if (words.length === 0) return <>{text}</>
  const whole = `(?<![\\p{L}])(?:${words.join('|')})[\\p{L}-]*`
  const pattern = new RegExp(`(${stems.length > 0 ? `${whole}|(?<![\\p{L}])(?:${stems.join('|')})` : whole})`, 'giu')
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

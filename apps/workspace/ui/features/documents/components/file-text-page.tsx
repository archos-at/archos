'use client'

import { useMemo } from 'react'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { parseDelimited } from '@/lib/text/delimited'
import { cn } from '@/lib/utils'

export const TEXT_PAGE_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv']

export function isTextPageType(contentType: string | null | undefined): boolean {
  return TEXT_PAGE_TYPES.includes(contentType ?? '')
}

export function FileTextPage({
  text,
  truncated,
  contentType,
  truncatedLabel,
  peeking,
  className,
}: {
  text: string
  truncated: boolean
  contentType: string | null | undefined
  truncatedLabel: string
  peeking?: boolean
  className?: string
}) {
  const kind = contentType === 'text/csv' ? 'csv' : contentType === 'text/plain' ? 'plain' : 'markdown'

  return (
    <div
      className={cn(
        'bg-sheet shadow-sm h-fit w-full max-w-[720px] overflow-hidden rounded-surface',
        peeking ? 'shadow-sm' : 'shadow-md' /* elevation 2 on the stage, as the image's page: elevation 3 is a dialog's */,
        className
      )}
    >
      <div className={cn('overflow-x-auto', peeking ? 'p-4' : 'p-6')}>
        {kind === 'csv' ? (
          <DelimitedTable text={text} />
        ) : kind === 'plain' ? (
          <pre className="text-foreground whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">
            {text}
          </pre>
        ) : (
          <MarkdownRenderer content={text} />
        )}
      </div>
      {truncated && (
        <p className="text-muted-foreground border-hairline border-t px-6 py-2.5 text-xs leading-relaxed" /* on the sheet: a hairline, no grey band */>
          {truncatedLabel}
        </p>
      )}
    </div>
  )
}

function DelimitedTable({ text }: { text: string }) {
  const { rows } = useMemo(() => parseDelimited(text), [text])
  if (rows.length === 0) return null

  const [head, ...body] = rows
  const columns = Math.max(...rows.map((row) => row.length))

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {Array.from({ length: columns }, (_, index) => (
            <th
              key={index}
              className="text-foreground border-b px-2.5 py-1.5 align-bottom font-medium"
            >
              {head[index] ?? ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b last:border-b-0">
            {Array.from({ length: columns }, (_, index) => (
              <td key={index} className="text-foreground/90 px-2.5 py-1.5 align-top">
                {row[index] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

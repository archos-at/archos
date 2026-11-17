'use client'

import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { documentFilesHref } from '@/features/documents/lib/document-question'
import { openFiledDocument } from '@/features/documents/lib/open-filed-document'
import { cn } from '@/lib/utils'
import type { DiagramFiling } from '../use-diagram-filing'

export const CAPTION_CONTROL =
  'inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function DiagramFilingControls({ filing, className }: { filing: DiagramFiling; className?: string }) {
  const t = useTranslations(diagramsCopy)
  const isMobile = useIsMobile()
  const { state, target, documentId } = filing

  if (!target) return null
  const href = documentId ? documentFilesHref(target.projectId, documentId) : null

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3', className)} data-testid="diagram-filing">
      {state.kind === 'filing' ? <span>{t('file.pending')}</span> : null}
      {/* What landed, in words, before any action: „das PDF fehlt" is the fact,
          and the controls after it are what to do about it. A partial filing
          says the smaller true thing rather than „abgelegt". */}
      {state.kind === 'filed' ? <span>{t('file.done')}</span> : null}
      {state.kind === 'partial' ? <span>{t('file.partial')}</span> : null}
      {href && documentId ? (
        <a
          href={href}
          className={CAPTION_CONTROL}
          data-testid="diagram-open-filed"
          onClick={(event) => {
            if (isMobile || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            void openFiledDocument({ documentId, projectId: target.projectId }).then((opened) => {
              if (!opened) window.location.assign(href)
            })
          }}
        >
          {t('file.open')}
        </a>
      ) : null}
      {/* The same call, and deliberately: `fileGeneratedDocument` is idempotent
          per (run, producer), so pressing this after a partial filing finds the
          SVG already filed and files only the PDF. That is why the label is
          „PDF ergänzen" and not „nochmals ablegen" — the button does the smaller
          thing, and saying otherwise would invite the reader to expect a second
          copy of the drawing.
          A `failed` state offers no retry: a refusal is a 400 about the bytes
          themselves, and the same bytes will be refused again. */}
      {state.kind === 'idle' || state.kind === 'partial' ? (
        <button
          type="button"
          onClick={() => void filing.file()}
          disabled={!filing.canFile}
          className={cn(CAPTION_CONTROL, 'disabled:cursor-not-allowed disabled:opacity-60')}
        >
          {state.kind === 'partial' ? t('file.completePdf') : t('file.action')}
        </button>
      ) : null}
      {state.kind === 'failed' ? <span className="text-destructive">{state.message}</span> : null}
    </span>
  )
}

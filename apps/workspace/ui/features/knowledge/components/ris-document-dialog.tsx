'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ApiRequestError } from '@/adapters/api/api-error'
import { getRisDocument, type LoadedDocument } from '@/adapters/api/knowledge-client'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { locatePassageInText } from '../lib/passage-highlight'

export interface RisDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  title: string
  highlight?: string | null
  highlightColor?: string
  headerChip?: ReactNode
  headerActions?: ReactNode
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; document: LoadedDocument }
  | { status: 'failed' }
  | { status: 'busy' }

export function RisDocumentDialog({
  open,
  onOpenChange,
  url,
  title,
  highlight,
  highlightColor,
  headerChip,
  headerActions,
}: RisDocumentDialogProps) {
  const t = useTranslations(knowledgeCopy)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const markRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    getRisDocument(url, highlight?.slice(0, 2000))
      .then((document) => {
        if (cancelled) return
        setState({ status: 'ready', document })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const rateLimited = error instanceof ApiRequestError && error.status === 429
        setState(rateLimited ? { status: 'busy' } : { status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [open, url, highlight])

  const text = state.status === 'ready' ? state.document.text : ''
  const passage = useMemo(
    () => (text && highlight ? locatePassageInText(text, highlight) : null),
    [text, highlight]
  )

  useEffect(() => {
    if (!passage) return
    const frame = requestAnimationFrame(() => markRef.current?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [passage])

  const heading = (state.status === 'ready' && state.document.title) || title

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] max-w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] flex-col gap-3 p-4 sm:max-w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] sm:p-5">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            {headerChip}
            <span className="min-w-0 flex-1 line-clamp-2 break-words" title={heading}>{heading}</span>
            {headerActions}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3 text-xs">
            {t('risViewer.description')}
            <a
              href={state.status === 'ready' ? state.document.url : url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary duration-quick inline-flex items-center gap-1 font-medium transition-opacity ease-out hover:opacity-80 pointer-coarse:min-h-11"
            >
              <ExternalLink className="size-3" aria-hidden />
              {t('risViewer.openAtRis')}
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="border-border bg-surface-sunken min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border p-4">
          {state.status === 'loading' && (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
              <Spinner className="size-4" />
              {t('risViewer.loading')}
            </div>
          )}
          {(state.status === 'failed' || state.status === 'busy') && (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm">
              <AlertTriangle className="size-5" aria-hidden />
              <p>{t(state.status === 'busy' ? 'risViewer.busy' : 'risViewer.failed')}</p>
            </div>
          )}
          {state.status === 'ready' && (
            <article className="text-foreground mx-auto max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed pointer-coarse:text-base hyphens-auto" lang="de">
              {passage ? (
                <>
                  {text.slice(0, passage.start)}
                  <mark
                    ref={markRef}
                    className="rounded-sm px-0.5"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${highlightColor ?? 'var(--foreground)'} 28%, transparent)`,
                      color: 'inherit',
                    }}
                  >
                    {text.slice(passage.start, passage.end)}
                  </mark>
                  {text.slice(passage.end)}
                </>
              ) : (
                text
              )}
              {state.document.truncated && (
                <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
                  {t('risViewer.truncated')}
                </p>
              )}
            </article>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

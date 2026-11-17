'use client'

import type { JSX } from 'react'

import { type ReactNode } from 'react'

import { InsetStage } from '@/components/ui/inset-stage'

import { ClampedText } from '@/components/ui/clamped-text'

import { useTranslations } from '@/i18n'

import { filesCopy } from '@/i18n/namespaces/files'

import { cn } from '@/lib/utils'

import type { DocumentKind } from '../document-kind'
import { DocumentKindThumbnail } from './document-kind-thumbnail'

export const SUMMARY_CLAMP_LINES = 5

export type PeekView = 'document' | 'details'

export function PeekPanel({
  peeking,
  active,
  view,
  children,
}: {
  peeking: boolean
  active: boolean
  view: PeekView
  children: ReactNode
}): JSX.Element {
  if (!peeking) return <>{children}</>
  return (
    <div data-testid={`file-peek-${view}`} hidden={!active} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}

export function PeekStage({ peeking, children }: { peeking: boolean; children: ReactNode }): JSX.Element {
  if (!peeking) return <>{children}</>
  return (
    <InsetStage data-testid="file-peek-stage" className="mx-3 flex min-h-0 flex-1 flex-col">
      {children}
    </InsetStage>
  )
}

export function IndexedSummary({ summary }: { summary: string }) {
  const t = useTranslations(filesCopy)
  return (
    <div className="p-3">
      <ClampedText
        lines={SUMMARY_CLAMP_LINES}
        moreLabel={t('preview.summaryMore')}
        lessLabel={t('preview.summaryLess')}
        className="text-foreground text-sm leading-5" /* the body step, 14/20/440: at 1.55 it out-sized the dialog title */
      >
        {summary}
      </ClampedText>
    </div>
  )
}

export function PageMock({
  caption,
  action,
  skeleton,
  kind,
}: {
  caption?: string
  action?: ReactNode
  skeleton?: boolean
  kind?: DocumentKind
}) {
  return (
    <div className="bg-background h-fit min-h-[320px] w-full max-w-[520px] rounded-surface p-7 shadow-lg">
      <div className="flex items-baseline justify-between border-b pb-2.5">
        <div className="space-y-1.5">
          {/* The alphas are the point here, not drift: a skeleton paints solid
              bars (content is COMING), the page mock paints faded ones (this is
              an illustration of a page, and nothing is coming). Same bars, two
              claims, and the opacity is what separates them. */}
          <div className={cn('h-[9px] w-28 rounded-surface', skeleton ? 'bg-muted' : 'bg-muted/50')} />
          <div
            className={cn('h-[6px] w-16 rounded-surface', skeleton ? 'bg-muted/70' : 'bg-muted/40')}
          />
        </div>
        <div className={cn('h-[6px] w-12 rounded-surface', skeleton ? 'bg-muted/70' : 'bg-muted/40')} />
      </div>
      <div className="mt-3.5 flex h-[260px] flex-col items-center justify-center gap-3 rounded border border-dashed px-6 text-center">
        {/* Faint, and never while loading: a skeleton claims content is coming,
            and a line drawing is not that claim. */}
        {!skeleton && kind && (
          <DocumentKindThumbnail kind={kind} className="text-muted-foreground/45 h-16 w-24" />
        )}
        {/* A caption while loading is a statement of what is coming ("PDF
            preview being created"), which a skeleton may make; most loads have
            none and stay bare. */}
        {caption && (
          <p className="text-muted-foreground max-w-[80%] text-balance text-xs leading-relaxed">
            {caption}
          </p>
        )}
        {action}
      </div>
      {/* Body lines only while loading: bars under a caption that says the file
          cannot be previewed would be text this document does not have. */}
      {skeleton && (
        <div className="mt-3.5 space-y-1.5">
          <div className="bg-muted h-[7px] w-3/5 rounded" />
          <div className="bg-muted h-[7px] w-1/2 rounded" />
          <div className="bg-muted h-[7px] w-[55%] rounded" />
        </div>
      )}
    </div>
  )
}

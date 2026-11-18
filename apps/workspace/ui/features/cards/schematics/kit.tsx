'use client'

import { type FC, type ReactNode, useState } from 'react'
import { FileText, Scale, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { CARD_SHELL } from '../components/card-chrome'
import { StatusBadge } from '../components/status-badge'
import { PdfViewerDialog } from '@/features/knowledge/components/pdf-viewer-dialog'
import { resolveCorpusFileName } from '@/features/knowledge/lib/resolve-corpus-file'
import { useCorpusFiles } from '@/features/knowledge/lib/use-corpus-files'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import type { DimStatus, NormReferenceData } from '@/shared/cards/schemas'

export { statusColor, statusLabel, worstStatus } from '../lib/dimension-status'
export {
  fmtComparator,
  fmtDim,
  fmtNum,
  fmtTolerance,
  missingLabel,
  provenanceLabel,
  provenanceTitle,
} from '../lib/dimension-format'
export { fitScale, legibleLabelSize, MAX_LABEL_GROWTH, MIN_LABEL_PX } from '../lib/schematic-scale'
export { DimensionArrow, ExtensionLine, SchematicCanvas, SvgLabel } from './schematic-drawing'
export { DimChecksList } from '../components/dim-checks-list'
export { LimitBar } from '../components/limit-bar'
export { StatusBadge } from '../components/status-badge'

interface NormRefFooterProps {
  reference: NormReferenceData | null | undefined
  bare?: boolean
}

export const NormRefFooter: FC<NormRefFooterProps> = ({ reference, bare = false }) => {
  const tKnowledge = useTranslations(knowledgeCopy)
  const corpusFiles = useCorpusFiles()
  const [viewerOpen, setViewerOpen] = useState(false)
  if (!reference?.document) return null
  const corpusFileName = resolveCorpusFileName(reference.document, corpusFiles)
  return (
    <div className={bare ? 'flex flex-col gap-2' : 'flex flex-col gap-2 border-t pt-3'}>
      <div className="card-caption flex flex-wrap items-center gap-2 text-muted-foreground">
        <Scale className="size-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">{reference.document}</span>
        {reference.section && (
          <Badge variant="outline" className="card-meta font-mono font-normal">
            {reference.section}
          </Badge>
        )}
        {reference.edition && <span>{reference.edition}</span>}
        {corpusFileName && (
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="inline-flex items-center gap-1 font-medium text-primary transition-opacity duration-quick ease-out hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <FileText className="size-3.5" aria-hidden="true" />
            {tKnowledge('viewer.view')}
          </button>
        )}
      </div>
      {reference.excerpt && (
        <Quote className="card-caption max-w-prose">{reference.excerpt}</Quote>
      )}
      {corpusFileName && viewerOpen && (
        <PdfViewerDialog open onOpenChange={setViewerOpen} fileName={corpusFileName} title={reference.document} />
      )}
    </div>
  )
}

interface SchematicCardProps {
  icon: LucideIcon
  eyebrow?: string
  title: string
  verdict?: DimStatus | null
  verdictNote?: ReactNode
  note?: string | null
  reference?: NormReferenceData | null
  children: ReactNode
}

export const SchematicCard: FC<SchematicCardProps> = ({
  icon: Icon,
  eyebrow,
  title,
  verdict,
  verdictNote,
  note,
  reference,
  children,
}) => {
  const t = useTranslations(chatCopy)
  return (
    <Card className={cn(CARD_SHELL, 'gap-3 p-5')}>
      {/* The eyebrow never wraps; where the pills do not fit beside it, they
          move to a line of their own as one row, right-aligned, rather than
          stacking one under the other beside a broken eyebrow. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="card-eyebrow flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
          <span>{eyebrow ?? t('cards.kit.eyebrow')}</span>
        </div>
        {(verdict || verdictNote) && (
          <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">
            {verdictNote}
            {verdict && <StatusBadge status={verdict} />}
          </span>
        )}
      </div>

      <p className="card-title text-foreground">{title}</p>

      {children}

      {note && <p className="card-caption max-w-prose text-muted-foreground">{note}</p>}

      <NormRefFooter reference={reference} />
    </Card>
  )
}

import { Fragment, type FC } from 'react'
import { Scale, FileText, Archive, Globe, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { sourceSignalStyle } from '@/features/layout/components/SourceSignalChip'
import { SectionLabel } from '@/components/ui/section-label'
import { AuthorityTag } from '../AuthorityTag'
import { KIND_TO_SIGNAL, type SourceSignal } from '@/lib/source-kinds'
import {
  citationNumbers,
  documentTabLabel,
  isCited,
  type CitedDocument,
} from '../../lib/citations'
import type { RoundLocus } from '../../lib/retrieval-rounds'
import { Ruler } from 'lucide-react'
import { SourcePreviewChip } from '../SourcePreview'
import { CitationMarkers } from '../CitationMarker'
import { documentEdition, documentShortName } from '../../lib/document-names'
import { documentLocation, documentLocationDetail } from '../../lib/derivation-basis'

const SIGNAL_ICON: Record<SourceSignal, LucideIcon> = {
  law: Scale,
  project: FileText,
  office: Archive,
  auto: Globe,
  model: Ruler,
}

const RoundLoci: FC<{ loci: RoundLocus[]; marked: boolean; repeatLabel: string }> = ({
  loci,
  marked,
  repeatLabel,
}) => {
  const named = loci.filter((locus) => locus.detail)
  if (named.length === 0) return null
  return (
    <span className="tabular-nums">
      {named.map((locus, i) => (
        <Fragment key={`${locus.detail}-${i}`}>
          {i > 0 && ', '}
          {locus.detail}
          {marked && locus.repeat && (
            <span className="text-muted-foreground italic"> ({repeatLabel})</span>
          )}
        </Fragment>
      ))}
    </span>
  )
}

export type CardLink = 'selected' | 'linked' | 'receded'

export const RECEDED = 'opacity-60'
export const FOLDER_TAB_H = 22
export const FOLDER_TAB =
  'ml-2.5 inline-flex h-[22px] items-center gap-1 self-start rounded-t-md px-2 leading-[14px]'

export const UNCITED_DIM = 'opacity-75'

export const SourceCard: FC<{
  document: CitedDocument
  live?: boolean
  loci?: RoundLocus[]
  link?: CardLink
  onSelect?: () => void
}> = ({ document: doc, live = false, loci, link, onSelect }) => {
  const t = useTranslations(chatCopy)
  const tabLabel = documentTabLabel(doc, t)
  const Icon = SIGNAL_ICON[KIND_TO_SIGNAL[doc.kind]]
  const tint = sourceSignalStyle(doc.tint)
  const used = isCited(doc)
  const numbers = citationNumbers(doc)
  const allRepeat = !!loci && loci.length > 0 && loci.every((locus) => locus.repeat)
  const showAuthority =
    !!doc.authority && !tabLabel.toLowerCase().startsWith(doc.authority.toLowerCase())
  const fileName = doc.fileName ?? doc.title
  const edition = documentEdition(fileName, doc.title)
  const named = edition ? { ...doc, title: documentShortName(fileName, doc.title) } : doc
  const location = loci
    ? loci.flatMap((locus) => (locus.detail ? [locus.detail] : [])).join(', ')
    : (documentLocation(t, doc) ?? '')
  const locationDetail = loci ? undefined : documentLocationDetail(t, doc)

  return (
    <div
      role="listitem"
      data-source-card
      data-link={link}
      onClick={onSelect}
      className={cn(
        'duration-quick flex min-w-0 flex-col transition-opacity ease-out motion-reduce:transition-none',
        link === 'receded' && RECEDED
      )}
    >
      {/* Folder tab — tinted, seated on the card's top-left. */}
      <SectionLabel
        className={cn(FOLDER_TAB, 'max-w-[calc(100%-0.625rem)]')}
        style={{ backgroundColor: tint.backgroundColor, color: tint.color }}
      >
        {/* The glyph is dropped when a badge is shown: at column width the tab
            fits roughly one of icon / badge / full label, and "RIS" carries the
            provenance in TEXT — which satisfies the same a11y rule the icon
            exists for (colour is never the only carrier). */}
        {!showAuthority && (
          <Icon
            className="size-2.5 shrink-0"
            style={{ color: `var(--source-${doc.tint})` }}
            aria-hidden="true"
          />
        )}
        {showAuthority && <AuthorityTag>{doc.authority}</AuthorityTag>}
        <span className="truncate">{tabLabel}</span>
      </SectionLabel>

      {/* Card body. A document that was read but never cited sits back
          (dashed hairline, muted ink) so it never reads as grounding the answer
          did not use; the one the reader tapped wears a full outline. */}
      <div
        className={cn(
          'bg-card relative min-w-0 flex-1 rounded-surface px-3 py-2.5 shadow-xs hyphens-auto [overflow-wrap:break-word] [hyphenate-limit-chars:10_4_4]',
          !used && !live && 'border border-dashed shadow-none',
          !used && !live && link !== 'receded' && UNCITED_DIM,
          link === 'selected' && 'ring-foreground ring-1'
        )}
      >
        {/* The keyboard's way to the card's own toggle: a real button under the
            content, named by the document as the card names it, pressed while the card is the
            selection. The chip and the markers sit above it (`relative z-10`),
            so it wraps neither; a press anywhere else on the card lands on it,
            and its click bubbles to the card like any other tap there. */}
        {onSelect && (
          <button
            type="button"
            aria-pressed={link === 'selected'}
            aria-label={t('thinking.node.cardLink', {
              name: [named.title, edition].filter(Boolean).join(', '),
            })}
            data-source-card-toggle=""
            className={cn('absolute inset-0 cursor-pointer rounded-control outline-none', FOCUS_RING)}
          />
        )}

        {/* The card IS the citation — clicking it opens the document at the
            page the answer used, exactly as the chip under the answer does. */}
        <SourcePreviewChip
          citation={{ document: named }}
          variant="card"
          detail="name-only"
          className="relative z-10 border-0 bg-transparent p-0 shadow-none hover:bg-transparent pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:items-center focus-visible:ring-offset-card"
        />
        {edition && <p className="text-muted-foreground text-[13px] leading-[19px]">{edition}</p>}

        {(location || allRepeat || numbers.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] leading-[19px]">
            {location && (
              <span
                className="bg-muted text-foreground rounded-control px-1.5 tabular-nums"
                title={locationDetail}
              >
                {loci ? (
                  <RoundLoci
                    loci={loci}
                    marked={!allRepeat}
                    repeatLabel={t('thinking.node.roundDocRepeat')}
                  />
                ) : (
                  location
                )}
              </span>
            )}
            {/* A round that only re-fetched what it already had states THAT:
                the turn aggregate is identical on every repeat of the same
                file, which made a re-read indistinguishable from a new fetch. */}
            {allRepeat && (
              <span className="text-muted-foreground italic">
                {t('thinking.node.roundDocRepeat')}
              </span>
            )}
            {/* Which markers in the answer this document carries — the link
                between "what was read" and "what was used". */}
            {/* The answer's own marker: it peeks the passage and opens the
                document at its page, as the `[N]` in the prose does. Its press
                stays its own: the card's tap links the rows of the calls, and
                a press on the marker (or inside the peek and the viewer it
                opens, which bubble through React's tree from their portals)
                is not a tap on the card. */}
            {numbers.length > 0 && (
              <span
                data-source-card-markers=""
                className="text-foreground relative z-10 ml-auto text-[15px] font-medium tabular-nums"
                onClick={(event) => event.stopPropagation()}
              >
                <CitationMarkers numbers={numbers} />
              </span>
            )}
          </div>
        )}
        {/* "abgerufen, nicht zitiert" is a claim about the FINISHED answer, so
            it waits for the turn to land. Said to a screen reader; the dashed
            hairline says it to the eye. */}
        {!used && !live && <span className="sr-only">{t('thinking.readNotUsed')}</span>}
      </div>
    </div>
  )
}

export const BareSourceCard: FC<{ name: string; loci?: RoundLocus[]; workspace?: boolean }> = ({
  name,
  loci,
  workspace,
}) => {
  const t = useTranslations(chatCopy)
  const allRepeat = !!loci && loci.length > 0 && loci.every((locus) => locus.repeat)
  return (
    <div role="listitem" data-source-card className="flex min-w-0 flex-col">
      <div
        className={cn(
          'bg-card min-w-0 flex-1 rounded-surface border border-dashed px-3 py-2.5',
          UNCITED_DIM
        )}
      >
        {workspace ? (
          <>
            <p className="text-foreground line-clamp-2 text-sm leading-snug">
              {t('thinking.node.workspaceRead')}
            </p>
            <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{name}</p>
          </>
        ) : (
          <p className="text-foreground line-clamp-2 text-sm leading-snug">{name}</p>
        )}
        {loci && loci.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/* No hit tally to stand in for: a bare slot has no card, so the
                pill appears only when there is a repeat to declare. */}
            {allRepeat && (
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium italic">
                {t('thinking.node.roundDocRepeat')}
              </span>
            )}
            <RoundLoci
              loci={loci}
              marked={!allRepeat}
              repeatLabel={t('thinking.node.roundDocRepeat')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

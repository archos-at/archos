'use client'

/**
 * A proposed calibration (`drawing-calibration-set`, ADR-0183) as the one
 * question it is: "is the marked length 10.80 m?". The person answers it by
 * eye, so the card shows the clip of the page around the calibration's region
 * with the reference span on it, the question, what a yes means (the scale,
 * 1:100, once the page's size is known) and where it is (the document, the
 * page). „Bestätigen“ applies the proposal, „Verwerfen“ dismisses it.
 *
 * NOTHING ACCEPTED IS UNSEEN, WITHOUT THE ROWS. The generic receipt lists every
 * input and holds „Übernehmen“ until each long one was unfolded, so nobody
 * accepts what they were not shown. Here the rows, the action's name and
 * „Betrifft“ are left out, and that rule still holds: the clip and the two
 * sentences show every field of the call. The document and the page are the
 * picture and its caption, the region is the frame on it, the two points are
 * the ends of the span, and the length is in the question. The clip is
 * therefore the condition: until it is drawn „Bestätigen“ waits, and when it
 * cannot be drawn (the reader may not open the document, the file does not
 * load) {@link useCalibrationReceipt} hands back the body and the generic
 * receipt shows its rows, so nothing is accepted blind.
 *
 * An input the route's own schema would refuse (an older or malformed
 * proposal) is no calibration here: the generic receipt, unchanged.
 *
 * NOT IN AN MCP APPS FRAME. The same receipt is drawn inside other assistants
 * (`features/mcp-apps/proposal-card`), where the view has no session cookie and
 * `connect-src 'none'`: it could fetch neither the page nor pdf.js, and the
 * view is one inline script, so pdf.js would be half a megabyte bundled into
 * it for a picture that cannot load. `scripts/build-mcp-app-views.ts` resolves
 * this module to `features/mcp-apps/calibration-preview-stand-in.tsx`, whose
 * hook answers null: the receipt there is the generic one, rows and all.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { PageRegionThumbnail, SpanMark, type PagePlace } from '@/features/knowledge'
import { calibrationRatio, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import {
  calibrationDocumentParamsSchema,
  setCalibrationRequestSchema,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'
import { formatMetres } from '@/lib/format'
import type { OperationTargetView, ProposedChangeStatus } from '@/lib/proposals/types'

/** The catalog operation this card is for. */
export const CALIBRATION_SET_OPERATION = 'drawing-calibration-set'

/** The clip is never taller than this, in CSS pixels: generous, and still a card. */
const MAX_CLIP_HEIGHT = 380

export interface ProposedCalibration {
  documentId: string
  calibration: SetCalibrationRequest
}

/** The calibration an operation proposal would set, or null when it is another operation or its input does not fit the route's schema. */
export function proposedCalibrationOf(operation: string, input: Record<string, unknown>): ProposedCalibration | null {
  if (operation !== CALIBRATION_SET_OPERATION) return null
  const params = calibrationDocumentParamsSchema.safeParse(input.params)
  const body = setCalibrationRequestSchema.safeParse(input.body)
  if (!params.success || !body.success) return null
  return { documentId: params.data.id, calibration: body.data }
}

/** The clip: not yet drawn, drawn (with the page's size where it has one), or not drawable for this reader. */
type Clip = { status: 'waiting' } | { status: 'drawn'; pagePt: PageSizePt | null } | { status: 'failed' }

/**
 * What the calibration puts in place of the generic receipt's parts
 * (`ProposalReceiptProps`). The decided headline always; the open body, its
 * title and its button only while the clip can be drawn.
 */
export interface CalibrationReceiptParts {
  headline: (decided: { status: ProposedChangeStatus }) => string
  eyebrow?: undefined
  title?: string
  open?: ReactNode
  accept?: { label: string; working: string; prompt: null }
  acceptBlocked?: string | undefined
}

/**
 * The receipt of `operation` as a calibration to confirm, or null when it is
 * not one. The caller spreads the answer over the generic receipt's props.
 */
export function useCalibrationReceipt(
  operation: string,
  input: Record<string, unknown>,
  /** The server's names for what the call acts on: the document's name, where this reader may read it. */
  targets: readonly OperationTargetView[] = []
): CalibrationReceiptParts | null {
  const t = useTranslations(chatCopy)
  const proposed = useMemo(() => proposedCalibrationOf(operation, input), [operation, input])
  const [clip, setClip] = useState<Clip>({ status: 'waiting' })
  if (!proposed) return null

  const headline = ({ status }: { status: ProposedChangeStatus }): string => {
    if (status === 'applied' || status === 'partially_applied') return t('cards.operationProposal.calibration.applied')
    return status === 'failed' ? t('cards.proposalReceipt.failed') : t('cards.operationProposal.calibration.dismissed')
  }
  // Nothing to check by eye: the generic body, with every input.
  if (clip.status === 'failed') return { headline }

  const documentName = targets.find((target) => target.type === 'document' && target.id === proposed.documentId)?.name
  return {
    headline,
    eyebrow: undefined,
    title: t('cards.operationProposal.calibration.title'),
    open: <CalibrationQuestion proposed={proposed} documentName={documentName ?? null} clip={clip} onClip={setClip} />,
    accept: {
      label: t('cards.operationProposal.calibration.accept'),
      working: t('cards.operationProposal.calibration.accepting'),
      // The body asked already.
      prompt: null,
    },
    acceptBlocked: clip.status === 'waiting' ? t('cards.operationProposal.calibration.loading') : undefined,
  }
}

/** The clip with the span, the question, what a yes means, and where it is. */
function CalibrationQuestion({
  proposed,
  documentName,
  clip,
  onClip,
}: {
  proposed: ProposedCalibration
  documentName: string | null
  clip: Clip
  onClip: (clip: Clip) => void
}) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const { documentId, calibration } = proposed
  const { from, to, lengthM, page, region } = calibration
  const place = useMemo(
    (): PagePlace => ({
      document: { id: documentId, name: documentName ?? '', shelf: 'stored' },
      page,
      frame: 'page',
      region: [region.x, region.y, region.w, region.h],
    }),
    [documentId, documentName, page, region.x, region.y, region.w, region.h]
  )
  // The scale a yes sets, from the page as pdf.js opened it; none for a picture that has no paper size.
  const ratio = clip.status === 'drawn' && clip.pagePt ? calibrationRatio(calibration, clip.pagePt) : null

  return (
    <figure className="flex flex-col gap-3" data-testid="calibration-preview">
      <PageRegionThumbnail
        place={place}
        maxHeight={MAX_CLIP_HEIGHT}
        label={t('cards.operationProposal.calibration.picture', { page })}
        onDrawn={({ pagePt }) => onClip({ status: 'drawn', pagePt: pagePt ?? null })}
        onDenied={() => onClip({ status: 'failed' })}
        onUnavailable={() => onClip({ status: 'failed' })}
        overlay={(toDrawn) => <SpanMark from={toDrawn([from.x, from.y])} to={toDrawn([to.x, to.y])} />}
      />
      <figcaption className="flex flex-col gap-1">
        <p className="text-foreground text-lg leading-snug font-semibold" data-testid="calibration-question">
          {t('cards.operationProposal.calibration.question', { length: formatMetres(lengthM, locale) })}
        </p>
        {ratio && (
          <p className="text-foreground text-sm" data-testid="calibration-meaning">
            {t('cards.operationProposal.calibration.meaning', { ratio })}
          </p>
        )}
        <p className="card-caption text-muted-foreground" data-testid="calibration-caption">
          {documentName
            ? t('cards.operationProposal.calibration.caption', { document: documentName, page })
            : t('cards.operationProposal.calibration.captionPage', { page })}
        </p>
      </figcaption>
    </figure>
  )
}

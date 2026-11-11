'use client'

/**
 * What a person confirms when they accept a proposed calibration
 * (`drawing-calibration-set`, ADR-0183): "the distance between these two
 * points on this drawing is N metres". The receipt's input rows say it in
 * numbers nobody can check by eye, so this draws it: the clip of the page
 * around the calibration's region with the reference span on it, and one line
 * that states the length and the page.
 *
 * It adds to the generic receipt and replaces nothing: the rows stay, because
 * what is decided is what is stored. An input the route's own schema would
 * refuse (an older or malformed proposal) draws nothing here.
 *
 * The picture comes from the document's own routes (`PageRegionThumbnail`), so
 * a reader who may not open the document sees its tile saying so, and the
 * line then no longer speaks of marked points.
 *
 * NOT IN AN MCP APPS FRAME. The same receipt is drawn inside other assistants
 * (`features/mcp-apps/proposal-card`), where the view has no session cookie and
 * `connect-src 'none'`: it could fetch neither the page nor pdf.js, and the
 * view is one inline script, so pdf.js would be half a megabyte bundled into
 * it for a picture that cannot load. `scripts/build-mcp-app-views.ts` resolves
 * this module to `features/mcp-apps/calibration-preview-stand-in.tsx`, which
 * draws nothing: the receipt there is the generic one, rows and all.
 */

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { PageRegionThumbnail, SpanMark, type PagePlace } from '@/features/knowledge'
import {
  calibrationDocumentParamsSchema,
  setCalibrationRequestSchema,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'
import { formatMetres } from '@/lib/format'
import type { OperationTargetView } from '@/lib/proposals/types'

/** The catalog operation this preview is for. */
export const CALIBRATION_SET_OPERATION = 'drawing-calibration-set'

/** The clip is never taller than this, in CSS pixels: the card stays a card. */
const MAX_CLIP_HEIGHT = 260

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

export function CalibrationProposalPreview({
  operation,
  input,
  targets = [],
}: {
  operation: string
  input: Record<string, unknown>
  /** The server's names for what the call acts on: the document's name, where this reader may read it. */
  targets?: readonly OperationTargetView[]
}) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const proposed = useMemo(() => proposedCalibrationOf(operation, input), [operation, input])
  const [drawn, setDrawn] = useState(false)
  const documentId = proposed?.documentId
  const documentName = targets.find((target) => target.type === 'document' && target.id === documentId)?.name ?? ''
  const place = useMemo((): PagePlace | null => {
    if (!proposed) return null
    const { page, region } = proposed.calibration
    return {
      document: { id: proposed.documentId, name: documentName, shelf: 'stored' },
      page,
      frame: 'page',
      region: [region.x, region.y, region.w, region.h],
    }
  }, [proposed, documentName])

  if (!proposed || !place) return null
  const { from, to, lengthM, page } = proposed.calibration
  const values = { length: formatMetres(lengthM, locale), page }
  return (
    <figure className="flex flex-col gap-1.5" data-testid="calibration-preview">
      <PageRegionThumbnail
        place={place}
        maxHeight={MAX_CLIP_HEIGHT}
        label={t('cards.operationProposal.calibration.picture', { page })}
        onDrawn={() => setDrawn(true)}
        overlay={(toDrawn) => <SpanMark from={toDrawn([from.x, from.y])} to={toDrawn([to.x, to.y])} />}
      />
      {/* Marked points are spoken of only once they are on screen. */}
      <figcaption className="text-foreground text-sm" data-testid="calibration-confirm">
        {t(`cards.operationProposal.calibration.${drawn ? 'confirm' : 'confirmWithoutPicture'}`, values)}
      </figcaption>
    </figure>
  )
}

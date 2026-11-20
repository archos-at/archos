'use client'

import { useEffect, useId, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useNormDialog, type NormDialogDestination } from '@/components/norms/norm-dialog-slot'
import { countsOfRows, normDialogSettled, normDialogShown } from '@/components/norms/norm-dialog-telemetry'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { NormRecognition } from '@/lib/base-knowledge/wire'
import type { NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { NormDestination, NormOffer } from '@/lib/office-shelf/project-norms/wire'
import { EditionMissingError, placeNormRows, type NormPlacing } from '../lib/project-norm-placing'

type Translate = ReturnType<typeof useTranslations>

export interface PlacingNotice {
  tone: 'success' | 'warning'
  text: string
}

const PLACED_KEYS = { office_shelf: 'normOffer.moved', suggest: 'normOffer.suggested', project: 'normOffer.kept' } as const

export function placingNotice(t: Translate, placing: NormPlacing): PlacingNotice {
  if (placing.noDecider) {
    const names = placing.noDecider.managers.join(', ')
    return { tone: 'warning', text: names ? t('normOffer.noDecider', { names }) : t('normOffer.noDeciderNobody') }
  }
  if (placing.refused) return { tone: 'warning', text: t('normOffer.refused', { reason: placing.refused }) }
  const notNorm = placing.notNorm > 0 ? t(placing.notNorm === 1 ? 'normOffer.notNormOne' : 'normOffer.notNorm', { count: placing.notNorm }) : null
  const placed = placing.destination === 'project' || placing.norms > 0 ? t(PLACED_KEYS[placing.destination]) : null
  return { tone: 'success', text: [placed, notNorm].filter(Boolean).join(' ') }
}

export function offerRecognition(offers: readonly NormOffer[]): NormRecognition {
  return {
    proposals: offers.map((offer) => ({
      entryId: offer.documentId,
      documentId: offer.documentId,
      fileName: offer.fileName,
      kind: offer.kind,
      designation: offer.designation,
      editionLabel: offer.editionLabel,
      topicId: null,
      editionOf: null,
      duplicate: false,
    })),
    plain: [],
    topics: { rootId: null, folders: [], nextCursor: null },
  }
}

export interface ProjectNormDialogProps {
  projectId: string
  offers: readonly NormOffer[] | null
  canManageOfficeShelf: boolean
  run?: NormsFetch
  onClose: () => void
  onPlaced: (placing: NormPlacing) => void
}

export function ProjectNormDialog({ projectId, offers, canManageOfficeShelf, run, onClose, onPlaced }: ProjectNormDialogProps): JSX.Element | null {
  const NormDialog = useNormDialog()
  const t = useTranslations(filesCopy)
  const id = useId()
  const toOffice: NormDestination = canManageOfficeShelf ? 'office_shelf' : 'suggest'
  const [chosen, setChosen] = useState<NormDestination | null>(null)
  const destination = chosen ?? toOffice
  const offered = offers?.length ?? 0
  useEffect(() => {
    if (offers && offers.length > 0) normDialogShown('project_upload', offers.length)
  }, [offers])
  const close = () => {
    setChosen(null)
    onClose()
  }
  const later = () => {
    normDialogSettled('project_upload', { later: offered })
    close()
  }

  const place = async (rows: Parameters<NormDialogDestination['confirm']>[0]) => {
    let placing: NormPlacing
    try {
      placing = await placeNormRows(projectId, destination, rows, run)
    } catch (error) {
      throw new Error(t(error instanceof EditionMissingError ? 'normOffer.dialog.editionNeeded' : 'normOffer.failed'))
    }
    normDialogSettled('project_upload', countsOfRows(rows))
    const notice = placingNotice(t, placing)
    if (notice.tone === 'warning') toast.warning(notice.text)
    else toast.success(notice.text)
    onPlaced(placing)
  }

  const question = `${id}-question`
  const choice = (
    <div className="grid gap-2 border-t border-hairline pt-3" data-testid="project-norm-destination">
      <p id={question} className="text-sm font-medium text-foreground">
        {t(offers?.length === 1 ? 'normOffer.dialog.questionOne' : 'normOffer.dialog.question')}
      </p>
      <RadioGroup value={destination} onValueChange={(next) => setChosen(next as NormDestination)} aria-labelledby={question} className="gap-2.5">
        {[toOffice, 'project' as const].map((option) => (
          <div key={option} className="flex items-start gap-2 pointer-coarse:min-h-11">
            <RadioGroupItem id={`${id}-${option}`} value={option} className="mt-0.5" data-testid={`project-norm-destination-${option}`} />
            <Label htmlFor={`${id}-${option}`} className="flex flex-col items-start gap-0.5 font-normal">
              <span className="text-sm font-medium text-foreground">{t(`normOffer.dialog.${option}`)}</span>
              <span className="text-xs leading-snug text-muted-foreground">{t(`normOffer.dialog.${option}Hint`)}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )

  if (!NormDialog) return null
  return (
    <NormDialog
      recognition={offers && offers.length > 0 ? offerRecognition(offers) : null}
      onClose={later}
      onSettled={close}
      destination={{
        description: t('normOffer.dialog.body'),
        laterNotice: t('normOffer.dialog.later'),
        notNorm: true,
        choice,
        confirm: place,
      }}
    />
  )
}

'use client'

import { useCallback, useEffect, useState, type JSX } from 'react'
import Link from 'next/link'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  SuggestionActions,
  SuggestionButton,
  SuggestionPanel,
  SuggestionPanelHeader,
  SuggestionPanelLine,
  SuggestionReason,
} from '@/components/ui/suggestion-panel'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { fetchProjectNorms, placeProjectNorms, type NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { NormDestination, NormOffer, OfficeShelfReferenceView, ProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'
import { baseKnowledgeHref } from '@/lib/base-knowledge/entry-link'

export interface ProjectNormNoticesProps {
  projectId: string
  folderId: string | null
  revision?: string
  run?: NormsFetch
}

export function ProjectNormNotices({ projectId, folderId, revision, run }: ProjectNormNoticesProps): JSX.Element | null {
  const [norms, setNorms] = useState<ProjectNormsResponse | null>(null)

  const load = useCallback(async () => {
    try {
      setNorms(await fetchProjectNorms(projectId, folderId, run))
    } catch {
      setNorms(null)
    }
  }, [projectId, folderId, run])

  useEffect(() => {
    void load()
  }, [load, revision])

  if (!norms || (norms.offers.length === 0 && norms.references.length === 0)) return null
  return (
    <div className="grid grid-cols-1 gap-2" data-testid="project-norm-notices">
      {norms.offers.length > 0 && norms.canWrite && (
        <NormOfferPanel
          projectId={projectId}
          offers={norms.offers}
          canManageOfficeShelf={norms.canManageOfficeShelf}
          run={run}
          onPlaced={load}
        />
      )}
      {norms.references.length > 0 && <ShelfReferenceLines references={norms.references} />}
    </div>
  )
}

function NormOfferPanel({
  projectId,
  offers,
  canManageOfficeShelf,
  run,
  onPlaced,
}: {
  projectId: string
  offers: readonly NormOffer[]
  canManageOfficeShelf: boolean
  run?: NormsFetch
  onPlaced: () => Promise<void>
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [busy, setBusy] = useState(false)
  const names = offers.map((offer) => offer.designation ?? offer.fileName).join(', ')
  const toOffice: NormDestination = canManageOfficeShelf ? 'office_shelf' : 'suggest'

  const place = async (destination: NormDestination) => {
    setBusy(true)
    try {
      const placed = await placeProjectNorms(
        projectId,
        {
          destination,
          documents: offers.map((offer) => ({ documentId: offer.documentId })),
          ...(destination === 'project' ? {} : { visibility: 'office' as const }),
        },
        run
      )
      const refused = placed.placements.find((placement) => placement.outcome === 'refused')
      if (refused) toast.error(t('normOffer.refused', { reason: refused.reason ?? '' }))
      else toast.success(t(destination === 'office_shelf' ? 'normOffer.moved' : destination === 'suggest' ? 'normOffer.suggested' : 'normOffer.kept'))
      await onPlaced()
    } catch {
      toast.error(t('normOffer.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SuggestionPanel aria-labelledby="project-norm-offer-title" data-testid="project-norm-offer">
      <SuggestionPanelHeader id="project-norm-offer-title">{t('normOffer.title')}</SuggestionPanelHeader>
      <SuggestionPanelLine>
        <SuggestionReason className="min-w-0 flex-[1_1_18rem]">
          {t(offers.length === 1 ? 'normOffer.bodyOne' : 'normOffer.bodyMany', { names })}
        </SuggestionReason>
        <SuggestionActions>
          <SuggestionButton disabled={busy} onClick={() => void place(toOffice)} data-testid="project-norm-move">
            {t(canManageOfficeShelf ? 'normOffer.move' : 'normOffer.suggest')}
          </SuggestionButton>
          <SuggestionButton variant="ghost" disabled={busy} onClick={() => void place('project')} data-testid="project-norm-keep">
            {t('normOffer.keep')}
          </SuggestionButton>
        </SuggestionActions>
      </SuggestionPanelLine>
    </SuggestionPanel>
  )
}

function ShelfReferenceLines({ references }: { references: readonly OfficeShelfReferenceView[] }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <section aria-label={t('shelfReference.section')} className="grid grid-cols-1 gap-0.5" data-testid="shelf-references">
      {references.map((reference) => (
        <p
          key={reference.id}
          className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs"
          data-testid="shelf-reference"
          data-state={reference.state}
        >
          <Archive className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground min-w-0 truncate font-medium">{reference.fileName}</span>
          <span className="text-muted-foreground shrink-0">
            {t(reference.state === 'removed' ? 'shelfReference.removed' : 'shelfReference.inShelf')}
          </span>
          {reference.state === 'in_office_shelf' && (
            <Button asChild variant="inline" className="touch-target ml-auto shrink-0">
              <Link href={baseKnowledgeHref(reference.entryId)} aria-label={t('shelfReference.open', { name: reference.fileName })}>
                {t('shelfReference.openShort')}
              </Link>
            </Button>
          )}
        </p>
      ))}
    </section>
  )
}

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
import type { NormOffer, OfficeShelfReferenceView, ProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'
import { baseKnowledgeHref } from '@/lib/base-knowledge/entry-link'
import type { NormPlacing } from '../lib/project-norm-placing'
import { placingNotice, ProjectNormDialog } from './project-norm-dialog'

export interface ProjectNormNoticesProps {
  projectId: string
  folderId: string | null
  revision?: string
  run?: NormsFetch
  awaiting?: ReadonlySet<string>
  onAwaited?: (documentIds: readonly string[]) => void
}

export function ProjectNormNotices({ projectId, folderId, revision, run, awaiting, onAwaited }: ProjectNormNoticesProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const [norms, setNorms] = useState<ProjectNormsResponse | null>(null)
  const [asked, setAsked] = useState<readonly NormOffer[] | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const listed = await fetchProjectNorms(projectId, folderId, run)
      setNorms(listed)
      const arrived = listed.canWrite && awaiting ? listed.offers.filter((offer) => awaiting.has(offer.documentId)) : []
      if (arrived.length > 0) {
        setAsked((current) => current ?? arrived)
        onAwaited?.(arrived.map((offer) => offer.documentId))
      }
    } catch {
      setNorms(null)
    }
  }, [projectId, folderId, run, awaiting, onAwaited])

  useEffect(() => {
    void load()
  }, [load, revision])

  const placed = async (placing: NormPlacing) => {
    setBlocked(placing.noDecider ? placingNotice(t, placing).text : null)
    await load()
  }

  const dialog = norms && (
    <ProjectNormDialog
      projectId={projectId}
      offers={asked}
      canManageOfficeShelf={norms.canManageOfficeShelf}
      run={run}
      onClose={() => setAsked(null)}
      onPlaced={(placing) => void placed(placing)}
    />
  )
  if (!norms || (norms.offers.length === 0 && norms.references.length === 0)) return dialog
  return (
    <div className="grid grid-cols-1 gap-2" data-testid="project-norm-notices">
      {norms.offers.length > 0 && norms.canWrite && (
        <NormOfferPanel
          projectId={projectId}
          offers={norms.offers}
          canManageOfficeShelf={norms.canManageOfficeShelf}
          blocked={blocked}
          run={run}
          onAsk={() => setAsked(norms.offers)}
          onPlaced={load}
        />
      )}
      {norms.references.length > 0 && <ShelfReferenceLines references={norms.references} />}
      {dialog}
    </div>
  )
}

function NormOfferPanel({
  projectId,
  offers,
  canManageOfficeShelf,
  blocked,
  run,
  onAsk,
  onPlaced,
}: {
  projectId: string
  offers: readonly NormOffer[]
  canManageOfficeShelf: boolean
  blocked: string | null
  run?: NormsFetch
  onAsk: () => void
  onPlaced: () => Promise<void>
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [busy, setBusy] = useState(false)
  const names = offers.map((offer) => offer.designation ?? offer.fileName).join(', ')

  const keep = async () => {
    setBusy(true)
    try {
      const placed = await placeProjectNorms(
        projectId,
        { destination: 'project', documents: offers.map((offer) => ({ documentId: offer.documentId })) },
        run
      )
      const refused = placed.placements.find((placement) => placement.outcome === 'refused')
      if (refused) toast.error(t('normOffer.refused', { reason: refused.reason ?? '' }))
      else toast.success(t('normOffer.kept'))
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
          <SuggestionButton disabled={busy} onClick={onAsk} data-testid="project-norm-move">
            {t(canManageOfficeShelf ? 'normOffer.move' : 'normOffer.suggest')}
          </SuggestionButton>
          <SuggestionButton variant="ghost" disabled={busy} onClick={() => void keep()} data-testid="project-norm-keep">
            {t('normOffer.keep')}
          </SuggestionButton>
        </SuggestionActions>
      </SuggestionPanelLine>
      {blocked && (
        <p role="alert" className="text-xs leading-snug text-warning" data-testid="project-norm-no-decider">
          {blocked}
        </p>
      )}
    </SuggestionPanel>
  )
}

const REFERENCE_STATE_KEYS = {
  in_office_shelf: 'shelfReference.inShelf',
  unlisted: 'shelfReference.unlisted',
  removed: 'shelfReference.removed',
} as const

function referenceHref(reference: OfficeShelfReferenceView): string {
  if (reference.state === 'unlisted' && reference.officeDocumentId) {
    return `/app/office-shelf?doc=${encodeURIComponent(reference.officeDocumentId)}`
  }
  return baseKnowledgeHref(reference.entryId)
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
          <span className="text-muted-foreground shrink-0">{t(REFERENCE_STATE_KEYS[reference.state])}</span>
          {reference.state !== 'removed' && (
            <Button asChild variant="inline" className="touch-target ml-auto shrink-0">
              <Link href={referenceHref(reference)} aria-label={t('shelfReference.open', { name: reference.fileName })}>
                {t('shelfReference.openShort')}
              </Link>
            </Button>
          )}
        </p>
      ))}
    </section>
  )
}

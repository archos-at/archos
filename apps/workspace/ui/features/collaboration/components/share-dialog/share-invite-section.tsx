'use client'

import type { JSX } from 'react'
import { AlertTriangle, Info, Search } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { ShareCandidate } from '@/lib/sharing/types'
import type { UseSharingResult } from '../../hooks/use-sharing'
import { ShareCandidateRow } from './share-candidate-row'

interface ShareInviteSectionProps {
  sharing: UseSharingResult
  candidates: ShareCandidate[]
  candidatesLoading: boolean
  candidatesError: boolean
  reloadCandidates: () => void
  query: string
  onQueryChange: (query: string) => void
  filteredCandidates: ShareCandidate[]
}

export function ShareInviteSection({
  sharing,
  candidates,
  candidatesLoading,
  candidatesError,
  reloadCandidates,
  query,
  onQueryChange,
  filteredCandidates,
}: ShareInviteSectionProps): JSX.Element {
  const t = useTranslations(collaborationCopy)

  return (
    <section className="space-y-2.5">
      <SectionLabel as="h3">{t('sharing.invite.label')}</SectionLabel>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('sharing.invite.placeholder')}
          aria-label={t('sharing.invite.label')}
          className="pl-9"
        />
      </div>

      {candidatesLoading && candidates.length === 0 ? (
        <div className="space-y-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-11 w-full" />
          ))}
        </div>
      ) : candidatesError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle className="line-clamp-none">
            {t('sharing.errors.loadFailed')}
          </AlertTitle>
          <AlertDescription>
            <Button variant="secondary" size="sm" className="mt-2" onClick={reloadCandidates}>
              {t('sharing.errors.tryAgain')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : filteredCandidates.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          {/* A typed query that matches nothing is a search result,
              not an empty org — the two need different sentences. */}
          {query.trim().length > 0
            ? t('sharing.invite.noResults', { query: query.trim() })
            : t('sharing.invite.empty')}
        </p>
      ) : (
        <ul className="-mx-2">
          {/* Deliberately NOT animated. This is a SEARCH RESULT list —
              the input above filters it on every keystroke — and an
              exit animation keeps the filtered-out row mounted until it
              finishes, so results lag behind typing. Even a pure
              `layout` reflow puts the rows in constant motion while
              someone types a name. The animation budget is spent where
              movement carries meaning (the roster regrouping, a release,
              an archive), not here, where instant is the feature. */}
          {filteredCandidates.map((candidate) => (
            <ShareCandidateRow
              key={candidate.person.userId}
              candidate={candidate}
              saving={sharing.saving}
              grant={sharing.grant}
            />
          ))}
        </ul>
      )}

      {/* The rule behind every "Noch nicht im Projekt" badge above,
          stated ONCE. Per row it was a two-sentence paragraph repeated
          for each blocked colleague, which made list items different
          heights and buried the names it sat under. It is the same
          sentence — it just belongs to the list, not to a row. */}
      {filteredCandidates.some((candidate) => candidate.needsProjectAccess) && (
        <p
          data-testid="share-blocked-note"
          className="flex items-start gap-1.5 pt-0.5 text-xs leading-snug text-muted-foreground"
        >
          <Info className="mt-px size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0">
            {t('sharing.invite.needsProjectAccessHint')}
          </span>
        </p>
      )}
    </section>
  )
}

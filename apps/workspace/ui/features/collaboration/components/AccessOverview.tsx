'use client'

import type { JSX } from 'react'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { Users } from 'lucide-react'

import { motion, springSnap } from '@/components/motion'

import { AvatarStack, PersonAvatar } from '@/components/ui/avatar-stack'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type {
  ResourceAccessEntry,
  ResourceRole,
  ResourceSharingState,
} from '@/lib/sharing/types'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import { AccessChip, namedAudienceCount } from './AccessChip'
import { sortByRoleThenName } from './ParticipantStrip'

const GROUPS: ReadonlyArray<{ role: ResourceRole; headingKey: string }> = [
  { role: 'owner', headingKey: 'sharing.overview.ownersHeading' },
  { role: 'collaborator', headingKey: 'sharing.overview.collaboratorsHeading' },
  { role: 'viewer', headingKey: 'sharing.overview.viewersHeading' },
]

const CONSEQUENCE: Record<string, string> = {
  private: 'sharing.overview.viaVisibilityPrivate',
  project: 'sharing.overview.viaVisibilityProject',
  organization: 'sharing.overview.viaVisibilityOrganization',
}

export interface AccessOverviewProps {
  state: ResourceSharingState
  currentUserId?: string | null
  renderActions?: (entry: ResourceAccessEntry) => ReactNode
  showVisibility?: boolean
  className?: string
}

export function AccessOverview({
  state,
  currentUserId = null,
  renderActions,
  showVisibility = true,
  className,
}: AccessOverviewProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const instanceId = useId()

  const ordered = sortByRoleThenName(state.entries)
  const count = ordered.length
  const countLabel = count === 1 ? t('sharing.overview.countOne') : t('sharing.overview.countMany', { count })

  const derived = ordered.filter((entry) => entry.reason.startsWith('visibility-'))
  const named = ordered.filter((entry) => !entry.reason.startsWith('visibility-'))
  const namedCountLabel =
    named.length === 1
      ? t('sharing.overview.countOne')
      : t('sharing.overview.countMany', { count: named.length })

  const DERIVED_NAMES_SHOWN = 5
  const derivedNames = [
    ...derived.slice(0, DERIVED_NAMES_SHOWN).map((entry) => entry.person.name),
    ...(derived.length > DERIVED_NAMES_SHOWN
      ? [t('sharing.overview.derivedMore', { count: derived.length - DERIVED_NAMES_SHOWN })]
      : []),
  ].join(', ')

  const namedOthers = namedAudienceCount(ordered, currentUserId)

  const nameById = new Map(ordered.map((entry) => [entry.person.userId, entry.person.name]))

  const reasonFor = (entry: ResourceAccessEntry): string => {
    if (entry.reason !== 'grant') return t(`sharing.reasons.${entry.reason}`)
    const granter = entry.grantedBy ? nameById.get(entry.grantedBy) : null
    return granter ? t('sharing.reasons.grant', { name: granter }) : t('sharing.reasons.grantUnknown')
  }

  return (
    <section className={cn('space-y-4', className)} data-testid="access-overview">
      {/* ---- The RULE, and who it currently reaches ----
          One list mixing both kinds of access could not be read. "Alle im Projekt
          können mitlesen" sat as a caption above rows that were partly project
          members and partly named invitees, so nothing on screen answered the two
          questions a reader actually has: is this list everyone, and why is the
          count what it is? Worse, the derived rows carry no controls (rule 4 —
          there is no per-person deny) while the named ones do, which made an
          apparently uniform list behave two different ways.

          They are two different facts, so they are now two blocks. The rule states
          itself and shows the colleagues it resolves to as faces rather than rows:
          they are not individually actionable, and a row that cannot be acted on
          should not look like one that can. Their access changes by changing the
          rule directly above them. */}
      {showVisibility && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <AccessChip visibility={state.visibility} sharedWith={namedOthers} size="md" />
            {/* The count is only meaningful when it actually enumerates the
                audience: under a blanket rule it counts only the NAMED exceptions,
                so printing it next to "Alle im Projekt können mitlesen" would
                contradict the rule sentence (the server currently reports no
                derived entries). Once derived entries exist, the count is the
                union and can stand again. */}
            {(state.visibility === 'private' || derived.length > 0) && (
              <span className="text-xs tabular-nums text-muted-foreground">{countLabel}</span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(CONSEQUENCE[state.visibility] ?? CONSEQUENCE.private)}
          </p>
        </div>
      )}

      {derived.length > 0 && (
        <div
          data-testid="access-derived"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border bg-muted px-3 py-2.5"
        >
          <AvatarStack people={derived.map((entry) => entry.person)} size="sm" max={6} />
          {/* The NAMES, as text — not only as faces. "Who can see this?" is the
              question this whole panel answers, and answering it with unlabelled
              initials answers it worse than the mixed list did: `AvatarStack` has
              no accessible name, so a screen reader got nothing at all and a touch
              user had no hover to fall back on. Compact, but still readable. */}
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            <span className="text-foreground/75">{derivedNames}</span>
            {' — '}
            {t(`sharing.reasons.${derived[0].reason}`)}
          </p>
        </div>
      )}

      {/* ---- The NAMED people ---- */}
      <div className="space-y-4">
        {/* The heading earns its place only when "named" is a DISTINCTION — when a
            rule block sits above it, or when the caller suppressed the chip and
            this list needs its own label. With nothing derived, every person with
            access is a named one: the heading would introduce a hierarchy level
            over a single kind of thing, sitting directly above "EIGENTÜMER" at the
            same weight, and its count would restate the chip's. */}
        {named.length > 0 && (derived.length > 0 || !showVisibility) && (
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel as="h3">
              {/* "Namentlich" rather than "Personen mit Zugriff": with a rule block
                  above, this list is no longer everyone who has access, and a
                  heading that claims otherwise is the confusion this split fixes. */}
              {t('sharing.overview.namedHeading')}
            </SectionLabel>
            <span className="text-xs tabular-nums text-muted-foreground">{namedCountLabel}</span>
          </div>
        )}

        {named.length === 0 && derived.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={Users}
            title={t('sharing.overview.title')}
            description={t(CONSEQUENCE[state.visibility] ?? CONSEQUENCE.private)}
          />
        ) : (
          GROUPS.map(({ role, headingKey }) => {
            const group = named.filter((entry) => entry.role === role)
            if (group.length === 0) return null
            return (
              <motion.div
                key={role}
                layout
                transition={springSnap}
                className="space-y-1"
                data-testid={`access-group-${role}`}
              >
                <SectionLabel as="h3">{t(headingKey)}</SectionLabel>
                <ul className="-mx-2">
                  {group.map((entry) => (
                    <motion.li
                      key={entry.person.userId}
                      layout
                      layoutId={`${instanceId}-${entry.person.userId}`}
                      transition={springSnap}
                      data-testid="access-row"
                      data-role={entry.role}
                      data-reason={entry.reason}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-quick ease-out hover:bg-hover motion-reduce:transition-none"
                    >
                      <PersonAvatar person={entry.person} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {entry.person.name}
                          {entry.person.userId === currentUserId && (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              ({t('sharing.overview.you')})
                            </span>
                          )}
                        </p>
                        {/* Why they are here — quiet, but never absent. */}
                        <p className="truncate text-xs text-muted-foreground">{reasonFor(entry)}</p>
                        {/* Still shared with, no longer able to read what the chat
                            drew on (ADR-0088). Said plainly, never with the folder. */}
                        {entry.lostAccess && (
                          <p data-testid="access-lost" className="text-xs font-medium text-warning">
                            {t('sharing.lostAccess')}
                          </p>
                        )}
                      </div>
                      {/* No role label on the read-only overview: the group
                          heading above already says it, and repeating it per row
                          is noise in a panel meant to be scanned. */}
                      {renderActions && (
                        <div className="flex shrink-0 items-center gap-1.5">{renderActions(entry)}</div>
                      )}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )
          })
        )}
      </div>
    </section>
  )
}

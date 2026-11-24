'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, MoreHorizontal, ShieldCheck, UserMinus, X } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { commonCopy } from '@/i18n/namespaces/common'
import {
  SHARING_ERROR_REASONS,
  type ResourceAccessEntry,
  type ResourceRole,
  type ResourceVisibility,
  type ShareableResourceType,
  type ShareCandidate,
} from '@/lib/sharing/types'
import type { SharingFailure, UseSharingResult } from '../hooks/use-sharing'
import { useShareCandidates } from '../hooks/use-sharing'
import { conversationLink } from '../lib/share-link'
import { canLeave, isBlocked, MAX_CANDIDATES, ROLE_OPTIONS, VISIBILITY_RANK } from '../lib/share-rules'
import { AccessOverview } from './AccessOverview'
import { ShareInviteSection } from './share-dialog/share-invite-section'
import { ShareLink } from './share-dialog/share-link'

type PendingConfirm =
  | { kind: 'visibility'; next: ResourceVisibility }
  | { kind: 'remove'; entry: ResourceAccessEntry }
  | { kind: 'escalate' }
  | { kind: 'leave' }

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceId: string | null
  sharing: UseSharingResult
  resourceType?: ShareableResourceType
  currentUserId?: string | null
  shareUrl?: string | null
}

export function ShareDialog({
  open,
  onOpenChange,
  resourceId,
  sharing,
  resourceType = 'conversation',
  currentUserId = null,
  shareUrl,
}: ShareDialogProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const tCommon = useTranslations(commonCopy)

  const { state, loading, loadError, failure, saving, refresh } = sharing
  const canManage = state?.canManage ?? false

  const {
    candidates,
    loading: candidatesLoading,
    error: candidatesError,
    reload: reloadCandidates,
  } = useShareCandidates(resourceType, resourceId, open && canManage)

  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const roleLabel = (role: ResourceRole): string => t(`sharing.roles.${role}`)

  const restrictedContentMessage = (value: SharingFailure): string => {
    if (!value.person) return t('sharing.errors.restrictedContentSomeone')
    const folders = value.folders ?? []
    return folders.length > 0
      ? t('sharing.errors.restrictedContentFolders', { name: value.person, folders: folders.join(', ') })
      : t('sharing.errors.restrictedContent', { name: value.person })
  }

  const failureMessage = (value: SharingFailure): string => {
    if (value.reason === SHARING_ERROR_REASONS.lastOwner) return t('sharing.errors.lastOwner')
    if (value.reason === SHARING_ERROR_REASONS.rateLimited) return t('sharing.errors.rateLimited')
    if (value.reason === SHARING_ERROR_REASONS.rosterFull) return t('sharing.errors.rosterFull')
    if (value.reason === SHARING_ERROR_REASONS.restrictedContent) return restrictedContentMessage(value)
    if (value.reason === SHARING_ERROR_REASONS.restrictedContentSelf) return t('sharing.errors.restrictedContentSelf')
    if (value.reason === SHARING_ERROR_REASONS.restrictedContentProject) {
      return t('sharing.errors.restrictedContentProject')
    }
    if (value.reason === SHARING_ERROR_REASONS.crossProjectContent) {
      return value.person
        ? t('sharing.errors.crossProjectContent', { name: value.person })
        : t('sharing.errors.crossProjectContentSomeone')
    }
    if (value.reason === SHARING_ERROR_REASONS.crossProjectContentSelf) return t('sharing.errors.crossProjectContentSelf')
    if (value.reason === SHARING_ERROR_REASONS.crossProjectContentProject) {
      return t('sharing.errors.crossProjectContentProject')
    }
    if (value.reason === SHARING_ERROR_REASONS.containerAccessRequired) {
      return t('sharing.errors.containerAccessRequired')
    }
    if (value.reason === SHARING_ERROR_REASONS.organizationMembershipRequired) {
      return t('sharing.errors.organizationMembershipRequired')
    }
    return t('sharing.errors.saveFailed')
  }

  const derivedEntries = useMemo(
    () =>
      (state?.entries ?? []).filter(
        (entry) => entry.reason === 'visibility-project' || entry.reason === 'visibility-organization',
      ),
    [state],
  )

  const rosterUserIds = useMemo(
    () => new Set((state?.entries ?? []).map((entry) => entry.person.userId)),
    [state],
  )

  const filteredCandidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = candidates.filter(
      (candidate) =>
        !candidate.alreadyHasAccess &&
        !rosterUserIds.has(candidate.person.userId) &&
        `${candidate.person.name} ${candidate.person.email ?? ''}`.toLowerCase().includes(needle),
    )
    const weight = (candidate: ShareCandidate): number => (isBlocked(candidate) ? 1 : 0)
    return matches
      .sort((a, b) => weight(a) - weight(b) || a.person.name.localeCompare(b.person.name))
      .slice(0, MAX_CANDIDATES)
  }, [candidates, query, rosterUserIds])

  if (!resourceId) return null

  const link =
    shareUrl !== undefined
      ? shareUrl
      : open && typeof window !== 'undefined'
        ? conversationLink(resourceType, resourceId, window.location)
        : null

  const handleVisibilityChange = (next: ResourceVisibility): void => {
    if (!state || next === state.visibility) return
    if (VISIBILITY_RANK[next] < VISIBILITY_RANK[state.visibility]) {
      setPending({ kind: 'visibility', next })
      return
    }
    void sharing.setVisibility(next)
  }

  const confirmProps = (): {
    title: string
    description: string
    confirmLabel: string
    children?: ReactNode
    onConfirm: () => Promise<boolean>
  } | null => {
    if (!pending) return null
    if (pending.kind === 'visibility') {
      return {
        title: t('sharing.visibilityHeading'),
        description: t(`sharing.visibility.${pending.next}Hint`),
        confirmLabel: t(`sharing.visibility.${pending.next}`),
        children: (
          <>
            {state && state.visibility !== 'private' && (
              <p className="mt-1 text-sm text-foreground" data-testid="visibility-loss-note">
                {t(`sharing.visibility.narrowLoss.${state.visibility}`)}
              </p>
            )}
            {derivedEntries.length > 0 && (
              <ul className="mt-1 space-y-1.5" data-testid="visibility-loss-list">
                {derivedEntries.map((entry) => (
                  <li key={entry.person.userId} className="flex items-center gap-2">
                    <PersonAvatar person={entry.person} size="sm" />
                    <span className="truncate text-sm text-foreground">{entry.person.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t(`sharing.reasons.${entry.reason}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
        onConfirm: () => sharing.setVisibility(pending.next),
      }
    }
    if (pending.kind === 'remove') {
      return {
        title: t('sharing.removeConfirm', { name: pending.entry.person.name }),
        description: t('sharing.removeConfirmHint'),
        confirmLabel: t('sharing.remove'),
        onConfirm: () => sharing.revoke(pending.entry.person.userId),
      }
    }
    if (pending.kind === 'escalate') {
      return {
        title: t('sharing.escalateConfirm'),
        description: t('sharing.escalateHint'),
        confirmLabel: t('sharing.escalate'),
        onConfirm: () => sharing.escalate(),
      }
    }
    return {
      title: t('sharing.leaveConfirm'),
      description: t('sharing.leaveConfirmHint'),
      confirmLabel: t('sharing.leave'),
      onConfirm: async () => {
        if (!currentUserId) return false
        const ok = await sharing.revoke(currentUserId)
        if (ok) onOpenChange(false)
        return ok
      },
    }
  }

  const confirm = confirmProps()

  const renderActions = (entry: ResourceAccessEntry): ReactNode => {
    const isSelf = entry.person.userId === currentUserId
    if (!canManage || entry.reason !== 'grant' || isSelf) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground transition-colors duration-snap ease-out hover:text-foreground motion-reduce:transition-none"
            disabled={saving}
            aria-label={t('sharing.manageFor', { name: entry.person.name })}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <SectionLabel>{t('sharing.roleHeading')}</SectionLabel>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={entry.role}
            onValueChange={(value) => {
              if (value === entry.role) return
              void sharing.changeRole(entry.person.userId, value as ResourceRole)
            }}
          >
            {ROLE_OPTIONS.map((role) => (
              <DropdownMenuRadioItem key={role} value={role}>
                {roleLabel(role)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setPending({ kind: 'remove', entry })}
          >
            <UserMinus className="mr-2 size-4" aria-hidden />
            {t('sharing.remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `grid-cols-[minmax(0,1fr)]`: DialogContent is a grid, and a grid's implicit
          `auto` column is floored at its widest item's min-content — so one row
          with a nowrap chip or a 150px select pushed the whole column past the
          dialog's own width and the controls were clipped off the right edge.
          Pinning the column to a zero-minimum 1fr makes the children shrink (they
          already carry `min-w-0` + `truncate`) instead of overflowing. */}
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] sm:max-w-xl"
        data-testid="share-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('sharing.title')}</DialogTitle>
          <DialogDescription>{t('sharing.overview.title')}</DialogDescription>
        </DialogHeader>

        {loading && !state ? (
          <div className="space-y-4" data-testid="share-dialog-skeleton" aria-busy="true">
            <span className="sr-only">{t('sharing.loading')}</span>
            <Skeleton className="h-6 w-40 rounded-md" />
            <Skeleton className="h-4 w-64" />
            <div className="space-y-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-11 w-full" />
              ))}
            </div>
          </div>
        ) : loadError && !state ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {/* line-clamp-none: AlertTitle clamps to one line by default, which
                truncates this sentence in German at a laptop width. */}
            <AlertTitle className="line-clamp-none">{t('sharing.errors.loadFailed')}</AlertTitle>
            <AlertDescription>
              <Button variant="secondary" size="sm" className="mt-2" onClick={refresh}>
                {t('sharing.errors.tryAgain')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : state ? (
          <div className="scroll-fade-bottom max-h-[min(72dvh,42rem)] space-y-5 overflow-y-auto pr-1 pb-6 max-sm:max-h-none max-sm:overflow-visible max-sm:pr-0">
            {/* A refused mutation must never look like it worked. */}
            {failure && (
              <Alert
                variant="destructive"
                data-testid="share-failure"
                className="animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none"
              >
                <AlertTriangle className="size-4" aria-hidden />
                <AlertDescription>{failureMessage(failure)}</AlertDescription>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 size-6"
                  aria-label={t('sharing.errors.dismiss')}
                  onClick={sharing.dismissFailure}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </Alert>
            )}

            {/* The blanket rule. Owners get the control; everyone else gets the
                statement (rendered by the overview below). */}
            {canManage && (
              <section className="space-y-2">
                <SectionLabel as="h3">{t('sharing.visibilityHeading')}</SectionLabel>
                <Select
                  value={state.visibility}
                  disabled={saving}
                  onValueChange={(value) => handleVisibilityChange(value as ResourceVisibility)}
                >
                  <SelectTrigger className="w-full" aria-label={t('sharing.visibilityHeading')}>
                    <SelectValue>{t(`sharing.visibility.${state.visibility}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* ONLY what the registry permits for this type. */}
                    {state.allowedVisibilities.map((visibility) => (
                      <SelectItem key={visibility} value={visibility}>
                        <div className="flex flex-col gap-0.5 py-0.5 text-left">
                          <span>{t(`sharing.visibility.${visibility}`)}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {t(`sharing.visibility.${visibility}Hint`)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* The one-line "who that means" for what is selected right now,
                    visible without opening the select (SH-17). */}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(`sharing.visibility.${state.visibility}Hint`)}
                </p>
              </section>
            )}

            <AccessOverview
              state={state}
              currentUserId={currentUserId}
              showVisibility={!canManage}
              renderActions={canManage ? renderActions : undefined}
            />

            {link && <ShareLink url={link} />}

            {canManage && (
              <>
                <Separator />
                <ShareInviteSection
                  sharing={sharing}
                  candidates={candidates}
                  candidatesLoading={candidatesLoading}
                  candidatesError={candidatesError}
                  reloadCandidates={reloadCandidates}
                  query={query}
                  onQueryChange={setQuery}
                  filteredCandidates={filteredCandidates}
                />
              </>
            )}

            {/* Taking ownership is legitimate; silent escalation is not — so it
                routes through the same explicit confirm as every other
                consequential change, and says it is audited (SH-10/SH-14). */}
            {state.canEscalate && (
              <>
                <Separator />
                <section className="space-y-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={saving}
                    onClick={() => setPending({ kind: 'escalate' })}
                  >
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {t('sharing.escalate')}
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('sharing.escalateHint')}
                  </p>
                </section>
              </>
            )}
          </div>
        ) : null}

        {/* `pt-4`: the scroll well ends flush against this footer, and on a phone
            the row dissolving at that boundary sat directly on the Close button —
            which reads as content sliding UNDER a control rather than as a list
            with more below it. A gap is what makes the two read as separate
            planes; the fade then says "more below" instead of "something is
            broken here". Only above, so the footer's own bottom padding (and the
            dialog's safe-area inset) are untouched. */}
        <DialogFooter className="pt-4 sm:justify-between">
          {/* Leaving needs no ownership (SH-12). An owner may leave too — as long
              as another owner remains; the last-owner invariant is enforced
              server-side, so the button simply isn't offered in that case. */}
          {state && state.myRole && currentUserId && canLeave(state, currentUserId) ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-danger-subtle hover:text-destructive"
              disabled={saving}
              onClick={() => setPending({ kind: 'leave' })}
            >
              {t('sharing.leave')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {t('sharing.close')}
          </Button>
        </DialogFooter>

        {confirm && (
          <ConfirmDialog
            open
            onOpenChange={(next) => {
              if (!next) setPending(null)
            }}
            title={confirm.title}
            description={confirm.description}
            confirmLabel={confirm.confirmLabel}
            cancelLabel={tCommon('actions.cancel')}
            tone="warning"
            onConfirm={async () => {
              const ok = await confirm.onConfirm()
              if (!ok) throw new Error('sharing mutation refused')
              setPending(null)
            }}
          >
            {confirm.children}
            {/*
              The refusal has to be stated INSIDE the confirm. Keeping the
              confirmation open on a refusal is only an improvement if the reader
              can see why: Radix `aria-hidden`s the outer dialog while a nested
              one is open, and the overlay covers it — so the failure Alert in the
              body above is neither visible nor announced, and the user is left
              looking at an unchanged dialog with a live button they will simply
              press again. That is worse than the false success it replaced.
            */}
            {failure && (
              <p role="alert" data-testid="confirm-failure" className="text-sm text-destructive">
                {failureMessage(failure)}
              </p>
            )}
          </ConfirmDialog>
        )}
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useId, type JSX } from 'react'
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { useTranslations } from '@/i18n'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { CLAUSE_JOIN } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DraftBlocker, DraftSummary } from '../lib/draft'
import { CheckLine, FactLine, PinnedBar } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface DecisionBarProps {
  summary: DraftSummary
  acknowledgeSender: boolean
  impersonation?: boolean
  filingOpen?: boolean
  onAcknowledgeSender: (value: boolean) => void
  onFile: () => void
  onDismiss: () => void
  filing: boolean
  dismissing: boolean
  yieldPrimary?: boolean
  /** Blockers a notice above the mail already says; the bar does not say them twice. */
  saidAbove?: ReadonlyArray<DraftBlocker['kind']>
  /** The mail's own text says something: leaving it out is a loss, and the bar says so in ink. */
  substantiveText?: boolean
  className?: string
}

export function blockerText(blocker: DraftBlocker, t: Translate, summary?: Pick<DraftSummary, 'ownClaimedMail'>, impersonation = false): string | null {
  switch (blocker.kind) {
    case 'sender':
      return t(summary?.ownClaimedMail ? 'bar.blockers.senderOwn' : impersonation ? 'bar.blockers.senderImpersonation' : 'bar.blockers.sender')
    case 'project_closed':
    case 'thread_name_missing':
    case 'sender_only':
      return t(`bar.blockers.${blocker.kind}`)
    case 'folder_missing':
    case 'name_stop':
    case 'risk':
      return t(`bar.blockers.${blocker.kind}`, { count: blocker.count })
  }
}

export function planLabel(summary: DraftSummary, t: Translate, rootLabel: string): string {
  const folder = (path: string): string => (path === '' ? rootLabel : path)
  const clauses: string[] = []
  const text = summary.textPlan
  const redacted = text?.masked ? t('bar.plan.masked') : ''
  if (text?.kind === 'append') clauses.push(t('bar.plan.textAppend', { name: text.name }) + redacted)
  if (text?.kind === 'create') clauses.push(t('bar.plan.textCreate', { folder: folder(text.folder) }) + redacted)
  const { single, folders } = summary.filesPlan
  if (single) {
    clauses.push(
      single.revision
        ? t('bar.plan.fileRevision', { name: single.name, version: single.revision.version, of: single.revision.of })
        : single.folder === null
          ? t('bar.plan.fileNoFolder', { name: single.name })
          : t('bar.plan.file', { name: single.name, folder: folder(single.folder) })
    )
  } else if (summary.files > 0) {
    clauses.push(
      folders.length === 0
        ? t('bar.plan.filesNoFolder', { count: summary.files })
        : folders.length === 1
          ? t('bar.plan.files', { count: summary.files, folder: folder(folders[0]) })
          : t('bar.plan.filesFolders', { count: summary.files, folders: folders.length })
    )
  }
  return clauses.length > 0 ? clauses.join(CLAUSE_JOIN) : t('bar.fileNothing')
}

export function leftLabel(summary: DraftSummary, t: Translate): string | null {
  const { text, files } = summary.left
  const parts = [...(text ? [t('bar.leftText')] : []), ...(files.length <= 2 ? files : [t('bar.leftFiles', { count: files.length })])]
  return parts.length > 0 ? t('bar.left', { parts: parts.join(', ') }) : null
}

export function DecisionBar({
  summary,
  acknowledgeSender,
  impersonation = false,
  filingOpen = true,
  onAcknowledgeSender,
  onFile,
  onDismiss,
  filing,
  dismissing,
  yieldPrimary = false,
  saidAbove = [],
  substantiveText = false,
  className,
}: DecisionBarProps): JSX.Element {
  const summaryId = useId()
  const dismissId = useId()
  const t = useTranslations(inboundMailCopy)
  const nothing = summary.files === 0 && !summary.text
  const onlyDismiss = nothing && !impersonation
  const blockers = summary.blockers.filter((blocker) => blocker.kind !== 'sender' && !saidAbove.includes(blocker.kind))
  const blocked = !nothing && summary.blockers.length > 0
  const busy = filing || dismissing
  const offersFiling = !impersonation || filingOpen
  const messages = blockers.map((blocker) => blockerText(blocker, t)).filter((text): text is string => text !== null)
  const showsDismiss = !onlyDismiss && !(yieldPrimary && !impersonation)
  const plan = planLabel(summary, t, t('suggestion.root'))
  const left = offersFiling && !onlyDismiss ? leftLabel(summary, t) : null
  const leftWeighs = summary.undecided.length > 0 || (summary.left.text && substantiveText)
  const dismissNote = summary.dismissErases ? t('bar.dismissNoteErases') : t('bar.dismissNote', { days: INBOUND_MAIL_RESTORE_DAYS })

  return (
    <PinnedBar data-testid="decision-bar" className={className}>
      {offersFiling && (summary.needsSenderAcknowledgement || messages.length > 0) && (
        <div className="flex flex-col gap-1">
          {summary.needsSenderAcknowledgement && (
            <CheckLine checked={acknowledgeSender} onCheckedChange={onAcknowledgeSender} disabled={busy} testId="acknowledge-sender">
              <span className="text-foreground inline-flex items-start gap-1.5 font-medium">
                <ShieldAlert className="text-warning mt-px size-3.5 shrink-0 pointer-coarse:mt-0.5 pointer-coarse:size-4" aria-hidden />
                {/* What the person affirms, never „… Ablegen“: a box ending in the verb read as if ticking filed. */}
                {summary.claimedWriter
                  ? t('bar.acknowledgeClaimedMail', { name: summary.claimedWriter })
                  : t(summary.ownClaimedMail ? 'bar.acknowledgeOwnMail' : impersonation ? 'bar.acknowledgeImpersonation' : 'bar.acknowledgeSender')}
              </span>
            </CheckLine>
          )}
          {messages.map((text) => (
            <p key={text} className="text-muted-foreground text-xs" data-testid="decision-blocker">
              {text}
            </p>
          ))}
        </div>
      )}
      {/* On a desk what the presses do stands on the left, the presses on the right; on a phone it stands above them.
          DOM order is the reading order: „Verwerfen“, then the primary nearest the thumb. For an impersonation
          „Verwerfen“ IS the primary: it moves last, and filing (once opened) is the quiet one. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          {offersFiling && !onlyDismiss && (
            <p id={summaryId} className="text-foreground line-clamp-2 min-w-0 text-xs font-medium [overflow-wrap:anywhere]" data-testid="decision-summary" title={plan}>
              {plan}
            </p>
          )}
          {left && (
            <FactLine icon={leftWeighs ? AlertTriangle : Info} tone={leftWeighs ? 'warning' : 'muted'} testId="decision-left">
              {left}
            </FactLine>
          )}
          <p id={dismissId} className="text-muted-foreground text-xs" data-testid="decision-dismiss-note">
            {dismissNote}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 sm:gap-3">
          {/* While a batch bar is up its „Verwerfen“ is the one on screen: two raised „Verwerfen“ for two scopes, and a
              reader foot of two identical white presses, was round 3. This mail is dismissed from the bar once ticked. */}
          {showsDismiss && (
            <BusyButton
              type="button"
              size="sm"
              variant={impersonation && !yieldPrimary ? 'default' : 'secondary'}
              busy={dismissing}
              busyLabel={t('bar.dismissBusy')}
              onClick={onDismiss}
              blocked={filing}
              className={cn('min-w-0 flex-1 sm:flex-none', impersonation && 'order-last')}
              aria-describedby={dismissId}
              data-testid="decision-dismiss"
            >
              {t('bar.dismiss')}
            </BusyButton>
          )}
          {offersFiling && (
            <BusyButton
              type="button"
              size="sm"
              variant={impersonation || yieldPrimary ? 'secondary' : 'default'}
              busy={onlyDismiss ? dismissing : filing}
              busyLabel={onlyDismiss ? t('bar.dismissBusy') : t('bar.busy')}
              onClick={nothing ? onDismiss : onFile}
              blocked={onlyDismiss ? filing : dismissing}
              disabled={blocked}
              className={cn('min-w-0 sm:flex-none', showsDismiss ? 'flex-[2]' : 'flex-1')}
              aria-describedby={onlyDismiss ? dismissId : summaryId}
              data-testid="decision-file"
            >
              {/* The forged mail's yes has its own verb: „Ablegen“ beside a checked box read as every other filing. */}
              {impersonation && !summary.ownClaimedMail ? t('bar.fileGenuine') : onlyDismiss ? t('bar.dismiss') : t('bar.file')}
            </BusyButton>
          )}
        </div>
      </div>
    </PinnedBar>
  )
}

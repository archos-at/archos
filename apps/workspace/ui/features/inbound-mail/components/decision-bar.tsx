'use client'

/**
 * The decision about one mail, pinned to the bottom of the detail: „Verwerfen“
 * on the left, the one primary action on the right, and between them only
 * what the press still needs.
 *
 * The primary is the verb, „Ablegen“; beside it a muted sentence computed from
 * the draft says exactly what one press files („2 Dateien und den E-Mail-Text
 * ablegen“, „In E-Mail-Verlauf „Stellplatznachweis“ ablegen (wird Fassung
 * 4)“), and is the press's accessible description. With nothing chosen the
 * one press left is „Verwerfen“: the bar says it once, as the primary, not a
 * ghost „Verwerfen“ beside a black „Nichts ablegen“ that did the same. Above it:
 * the sender confirmation where filing needs it („Domain nicht bestätigt.
 * Trotzdem ablegen“), what still blocks the press, and the one consequence a
 * person would not guess (without the text, the original is erased).
 *
 * A mail only another member may file never gets this bar: a colleague reads
 * `ClaimedMailBar`, which offers „Verwerfen …“ alone.
 *
 * On a phone the bar is the bottom edge: the two buttons stack full width
 * with the primary nearest the thumb, and the home indicator's inset pads it.
 * Busy is not disabled: a pressed button keeps its focus and its width.
 */

import { useId, type JSX } from 'react'
import { Info, ShieldAlert } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import type { DraftBlocker, DraftSummary } from '../lib/draft'
import { CheckLine, FactLine, PinnedBar } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface DecisionBarProps {
  summary: DraftSummary
  acknowledgeSender: boolean
  /**
   * The mail reads as someone posing as another (`riskLevel: 'impersonation'`):
   * „Verwerfen“ is the primary press, and filing is offered only once the
   * person opened „Trotzdem ablegen …“ (`filingOpen`), as the secondary one,
   * behind a yes that says they checked the mail is real.
   */
  impersonation?: boolean
  filingOpen?: boolean
  onAcknowledgeSender: (value: boolean) => void
  onFile: () => void
  onDismiss: () => void
  filing: boolean
  dismissing: boolean
  /**
   * A batch bar is up in the list (mails are picked): it holds its pane's one primary, so the reader's steps back to
   * the raised press until the batch is cleared (one primary per area: a pane is an area, and a floating bar
   * replaces its pane's primary while it is shown).
   */
  yieldPrimary?: boolean
  /**
   * The choice the sentence summarises is on screen (the message's E-Mail-Verlauf radios): the sentence would repeat
   * it word for word 270px above, so it stays only as the press's accessible description until the choice scrolls away.
   */
  choiceInView?: boolean
  className?: string
}

function blockerText(blocker: DraftBlocker, t: (key: string, vars?: Record<string, string | number>) => string): string | null {
  switch (blocker.kind) {
    case 'sender':
      return null
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

/** The primary label for a draft, as the bar shows it; shared with the keyboard's „Wie gezeigt ablegen“. */
export function primaryLabel(summary: DraftSummary, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (summary.files > 0 && summary.text) return t('bar.fileBoth', { count: summary.files })
  if (summary.files > 0) return t('bar.fileFiles', { count: summary.files })
  if (summary.text && summary.thread) return t('bar.fileThread', { name: summary.thread.name, version: summary.thread.nextVersion })
  if (summary.text) return t('bar.fileText')
  return t('bar.fileNothing')
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
  choiceInView = false,
  className,
}: DecisionBarProps): JSX.Element {
  const summaryId = useId()
  const t = useTranslations(inboundMailCopy)
  const nothing = summary.files === 0 && !summary.text
  // Nothing chosen: the one press left is „Verwerfen“, said once, as the primary (one primary action per surface).
  const onlyDismiss = nothing && !impersonation
  const blockers = summary.blockers.filter((blocker) => blocker.kind !== 'sender')
  const blocked = !nothing && summary.blockers.length > 0
  const busy = filing || dismissing
  // An impersonation offers no filing until the person opened „Trotzdem ablegen …“.
  const offersFiling = !impersonation || filingOpen
  const messages = blockers.map((blocker) => blockerText(blocker, t)).filter((text): text is string => text !== null)

  return (
    <PinnedBar data-testid="decision-bar" className={className}>
      {offersFiling && (summary.needsSenderAcknowledgement || messages.length > 0 || (summary.originalErased && !nothing)) && (
        <div className="flex flex-col gap-1.5">
          {summary.needsSenderAcknowledgement && (
            <CheckLine checked={acknowledgeSender} onCheckedChange={onAcknowledgeSender} disabled={busy} testId="acknowledge-sender">
              <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                <ShieldAlert className="text-warning size-3.5 shrink-0" aria-hidden />
                {/* The member it claims answers for themself, under an impersonation too: „Ja, ich habe sie gesendet“. */}
                {t(summary.ownClaimedMail ? 'bar.acknowledgeOwnMail' : impersonation ? 'bar.acknowledgeImpersonation' : 'bar.acknowledgeSender')}
              </span>
            </CheckLine>
          )}
          {messages.map((text) => (
            <p key={text} className="text-muted-foreground text-xs" role="status" data-testid="decision-blocker">
              {text}
            </p>
          ))}
          {summary.originalErased && !nothing && (
            <FactLine icon={Info} testId="original-erased">
              {t('bar.originalErased')}
            </FactLine>
          )}
        </div>
      )}
      {/* DOM order is the phone's stacking order: „Verwerfen“ first, the primary last, nearest the thumb.
          For an impersonation „Verwerfen“ IS the primary: it moves last, and filing (once opened) is the quiet one. */}
      {/* Paired at the end of the bar, „Verwerfen“ the tonal secondary beside the primary (D4), as in the selection bar:
          a bare word beside the primary floated on the phone's full-width stack. */}
      {/* What one press files, said once beside the presses: the primary itself is the verb („Ablegen“). The label that
          said it all („In E-Mail-Verlauf „Stellplatznachweis“ ablegen (wird Fassung 4)“) ran 380px wide and out-shouted
          the mail; the sentence keeps it legible, and the press's description reads it to a screen reader. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {offersFiling && !onlyDismiss && (
          <p id={summaryId} className={cn('text-muted-foreground text-meta min-w-0 sm:mr-auto sm:truncate', choiceInView && 'hidden')} data-testid="decision-summary" title={primaryLabel(summary, t)}>
            {primaryLabel(summary, t)}
          </p>
        )}
        {/* While a batch bar is up its „Verwerfen“ is the one on screen: two raised „Verwerfen“ for two scopes, and a
            reader foot of two identical white presses, was round 3. This mail is dismissed from the bar once ticked. */}
        {!onlyDismiss && !(yieldPrimary && !impersonation) && (
          <BusyButton
            type="button"
            size="sm"
            variant={impersonation && !yieldPrimary ? 'default' : 'secondary'}
            busy={dismissing}
            busyLabel={t('bar.dismissBusy')}
            onClick={onDismiss}
            blocked={filing}
            className={cn('w-full sm:w-auto', impersonation && 'order-last')}
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
            className="w-full min-w-0 shrink-0 sm:w-auto"
            aria-describedby={onlyDismiss ? undefined : summaryId}
            data-testid="decision-file"
          >
            {onlyDismiss ? t('bar.dismiss') : t('bar.file')}
          </BusyButton>
        )}
      </div>
    </PinnedBar>
  )
}

'use client'

/**
 * One filed mail in the „E-Mails“ tab: one row per section of the thread
 * document, newest first.
 *
 * - **The heading**, exactly as the document prints it and a citation names
 *   it („14.10.2026, 09:12 · Mag. Huber (ma37.wien.gv.at)“), then „ab
 *   Fassung 4 · eingegangen …“: the Fassung the mail first appeared in.
 * - **How far its sender was confirmed**, in the three words a filed mail can
 *   carry; an unconfirmed domain wears the warning glyph, its words stay ink.
 *   A confirmed domain is said once per run of its mails (`entriesSayingTrust`).
 *   How it was filed is said only where no person decided it in the app (a
 *   follow, the archive import, an agent, an agent's card).
 * - **What came with it** (D36): every attachment, as a link to the document
 *   it became, „lag schon im Projekt“, or „nicht abgelegt“ with its reason
 *   (its bytes are then only in the original); one in a folder the reader may
 *   not see is counted, never named.
 * - **Its actions:** „Original (.eml)“, „Vergleichen“ (this mail's Fassung
 *   against the one before, the version comparison the Fassung timeline
 *   uses), and „Herauslösen …“ behind ⋯ for whoever may file mail here.
 *
 * A link or a citation that names this entry scrolls it into view and marks
 * it (`focused`): an ink bar on the leading edge, never a tint under muted
 * text (`design-language.md`).
 */

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, Bot, FileText, Forward, MailCheck, MoreHorizontal, Paperclip, Repeat2, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { FactLine } from '@/components/ui/fact-line'
import { Item } from '@/components/ui/item'
import { usePrefersReducedMotion } from '@/components/motion'
import { useLocale, useTranslations } from '@/i18n'
import { formatAbsoluteTime } from '@/lib/format'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import type { MailThreadEntryView, MailThreadFiledVia } from '@/lib/mail-thread/mail-thread-wire'
import { documentFilesHref } from '../../lib/document-question'
import { TextComparisonView, type TextComparison } from '../revision-text-comparison'
import type { MailThreadClient } from './client'
import { EntryOriginal } from './entry-original'
import { attachmentLines, comparedVersions, filedSenderTrust, headingParts, type AttachmentLine } from './mail-thread-model'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

/** The ways of filing worth a line: every other mail was decided by a person in the app. */
const FILED_VIA_ICON: Partial<Record<MailThreadFiledVia, typeof Bot>> = {
  agent: Bot,
  agent_proposal: Sparkles,
  follow: Repeat2,
  archive_import: Archive,
  // Filed by the sender's own verified mail, with nobody deciding in the app: the one filing a reader would not guess.
  sender: MailCheck,
}

export interface MailThreadEntryItemProps {
  projectId: string
  /** The thread document, whose Fassungen „Vergleichen“ reads. */
  documentId: string
  threadId: string
  entry: MailThreadEntryView
  /** The thread document's Fassungen, once read; null while they are not. */
  versions: readonly DocumentVersionView[] | null
  focused: boolean
  /** Whether this entry says its sender's trust: the newer mail of the same confirmed domain may have said it already. */
  showTrust?: boolean
  /** „Herauslösen …“ is offered: the reader may file mail here, and the thread has another mail. */
  onDetach?: (entry: MailThreadEntryView) => void
  client: MailThreadClient
}

export function MailThreadEntryItem({ projectId, documentId, threadId, entry, versions, focused, showTrust = true, onDetach, client }: MailThreadEntryItemProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  const { locale } = useLocale()
  const ref = useRef<HTMLLIElement>(null)
  // The revision timeline's own comparison, so a Fassung compared here reads as it does there.
  const [comparison, setComparison] = useState<TextComparison | null>(null)
  const reduceMotion = usePrefersReducedMotion()
  const trust = filedSenderTrust(entry.senderTrust)
  const compared = versions ? comparedVersions(entry, versions) : null
  const ViaIcon = FILED_VIA_ICON[entry.filedVia]
  const attachments = attachmentLines(entry.attachments)
  const heading = headingParts(entry.heading)

  useEffect(() => {
    if (!focused || !ref.current) return
    // Instant when the reader asked for less motion; the focus moves with it, so a screen reader lands here too.
    ref.current.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    ref.current.focus({ preventScroll: true })
  }, [focused, reduceMotion])

  const compare = async (): Promise<void> => {
    if (!compared) return
    if (comparison) {
      setComparison(null)
      return
    }
    setComparison({ rowKey: entry.id, status: 'loading' })
    try {
      const diff = await client.diff(documentId, compared.from.id, compared.to.id)
      setComparison({
        rowKey: entry.id,
        status: 'done',
        from: { number: compared.from.number, content: diff.from.content },
        to: { number: compared.to.number, content: diff.to.content },
      })
    } catch {
      setComparison({ rowKey: entry.id, status: 'failed' })
    }
  }

  const menu: ActionMenuEntry[] = onDetach
    ? [{ type: 'item', id: 'detach', label: t('entry.detach'), onSelect: () => onDetach(entry), testId: 'mail-entry-detach' }]
    : []

  const trustLine = (() => {
    if (trust === 'verified') {
      return { Icon: ShieldCheck, words: entry.signerDomain ? t('entry.trust.verified', { domain: entry.signerDomain }) : t('entry.trust.verifiedNoDomain') }
    }
    if (trust === 'unverified') return { Icon: ShieldAlert, words: t('entry.trust.unverified') }
    return { Icon: ShieldQuestion, words: t('entry.trust.notChecked') }
  })()

  return (
    // The linked entry is the list's current row (`Item`'s `data-current`): lifted, the selected hairline all round,
    // never a bar down its edge.
    <Item
      as="li"
      ref={ref}
      tabIndex={-1}
      id={`mail-entry-${entry.id}`}
      data-testid="mail-thread-entry"
      data-entry-id={entry.id}
      data-focused={focused || undefined}
      data-current={focused || undefined}
      aria-current={focused ? 'location' : undefined}
      className="flex-col items-stretch gap-2 px-3 hover:bg-transparent"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The heading as the document prints it, wrapping between its date, name and domain, never inside the date. */}
          <h4 className="text-foreground text-sm font-medium leading-snug" data-testid="mail-thread-entry-heading">
            {heading.when && <span className="whitespace-nowrap tabular-nums">{heading.when}</span>}
            <span className="[overflow-wrap:anywhere]">{heading.who}</span>
            {/* The space stays outside the block, where a line may break; the parenthesis keeps its domain. */}
            {heading.domain && (
              <>
                {' '}
                <span className="text-muted-foreground inline-block max-w-full font-normal [overflow-wrap:anywhere]">{heading.domain.trimStart()}</span>
              </>
            )}
          </h4>
          {/* Two facts that wrap as units: a separator dot left dangling at the rail's edge read as a fault. */}
          <p className="text-muted-foreground flex flex-wrap gap-x-2.5 text-xs tabular-nums leading-snug">
            {entry.firstVersion && (
              <span className="text-foreground whitespace-nowrap font-medium" data-testid="mail-thread-entry-from">
                {t('entry.fromRevision', { number: entry.firstVersion.number })}
              </span>
            )}
            <span className="whitespace-nowrap">{t('entry.received', { time: formatAbsoluteTime(entry.receivedAt, locale) })}</span>
          </p>
        </div>
        {menu.length > 0 && (
          <ActionMenu
            mode="dropdown"
            entries={menu}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground touch-target -my-1 size-6 shrink-0"
                aria-label={t('entry.menu', { heading: entry.heading })}
                title={t('entry.menu', { heading: entry.heading })}
                data-testid="mail-entry-menu"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            }
          />
        )}
      </div>

      {entry.forwardedBy && (entry.forwardedBy.name || entry.forwardedBy.domain) && (
        <FactLine icon={Forward} testId="mail-thread-entry-forwarded-by">
          {t('entry.forwardedBy', {
            name: [entry.forwardedBy.name, entry.forwardedBy.domain && `(${entry.forwardedBy.domain})`].filter(Boolean).join(' '),
          })}
        </FactLine>
      )}
      {showTrust && (
        <FactLine icon={trustLine.Icon} tone={trust === 'unverified' ? 'warning' : 'muted'} testId="mail-thread-entry-trust" data-trust={trust}>
          {trustLine.words}
        </FactLine>
      )}
      {ViaIcon && (
        <FactLine icon={ViaIcon} testId="mail-thread-entry-via">
          {t(`entry.filedVia.${entry.filedVia}`)}
        </FactLine>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Paperclip className="size-3.5 shrink-0" aria-hidden />
            {t('attachments.label')}
          </p>
          <ul className="flex flex-col gap-0.5 pl-5" data-testid="mail-thread-entry-attachments">
            {attachments.map((line) => (
              <AttachmentItem key={line.position} projectId={projectId} line={line} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3" /* tonal presses 12px apart, the first on the entry's edge */>
        <EntryOriginal entry={entry} download={() => client.downloadOriginal(projectId, threadId, entry.id)} />
        {compared && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={comparison !== null}
            aria-label={t('entry.compareLabel', { from: compared.from.number, to: compared.to.number })}
            onClick={() => void compare()}
            data-testid="mail-thread-entry-compare"
          >
            {comparison ? t('entry.compareClose') : t('entry.compare')}
          </Button>
        )}
      </div>

      {comparison && (
        <div data-testid="mail-thread-entry-comparison" data-state={comparison.status}>
          <TextComparisonView comparison={comparison} />
        </div>
      )}
    </Item>
  )
}

function AttachmentItem({ projectId, line }: { projectId: string; line: AttachmentLine }): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  if (line.kind === 'hidden') {
    return (
      <li className="text-muted-foreground text-xs leading-snug" data-testid="mail-thread-attachment" data-disposition="hidden">
        {t('attachments.hidden')}
      </li>
    )
  }
  const name = line.name || t('attachments.unnamed', { position: line.position })
  const named =
    line.kind !== 'not_filed' && line.documentId ? (
      <Link
        href={documentFilesHref(projectId, line.documentId)}
        // The kit's inline underline (at rest, firming on hover); a file name wraps, so not the inline Button.
        className="text-foreground decoration-foreground/40 hover:decoration-foreground rounded-inline inline-flex min-h-6 min-w-0 items-center gap-1 underline underline-offset-[3px] outline-none transition-colors duration-quick ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
        data-testid="mail-thread-attachment-link"
      >
        <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      </Link>
    ) : (
      <span className="inline-flex min-w-0 items-start gap-1">
        <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      </span>
    )
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-snug" data-testid="mail-thread-attachment" data-disposition={line.kind}>
      {named}
      {line.kind === 'already_present' && <span className="text-muted-foreground">{t('attachments.alreadyPresent')}</span>}
      {line.kind === 'not_filed' && (
        <span className="text-muted-foreground">
          {t('attachments.notFiled', { reason: line.reason ? t(`attachments.reasons.${line.reason}`) : t('attachments.inOriginal') })}
        </span>
      )}
    </li>
  )
}

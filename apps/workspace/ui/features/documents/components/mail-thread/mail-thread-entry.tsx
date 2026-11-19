'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, Bot, FileText, Folder, Forward, MailCheck, MoreHorizontal, Paperclip, Repeat2, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { FactLine } from '@/components/ui/fact-line'
import { FittedName } from '@/components/ui/fitted-name'
import { Item } from '@/components/ui/item'
import { usePrefersReducedMotion } from '@/components/motion'
import { useLocale, useTranslations } from '@/i18n'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import type { MailThreadEntryView, MailThreadFiledVia } from '@/lib/mail-thread/mail-thread-wire'
import { documentFilesHref } from '../../lib/document-question'
import { TextComparisonView, type TextComparison } from '../revision-text-comparison'
import type { MailThreadClient } from './client'
import { EntryOriginal, originalState } from './entry-original'
import { attachmentLines, comparedVersions, filedSenderTrust, headingParts, receivedAtLabel, type AttachmentLine } from './mail-thread-model'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

const FILED_VIA_ICON: Partial<Record<MailThreadFiledVia, typeof Bot>> = {
  agent: Bot,
  agent_proposal: Sparkles,
  follow: Repeat2,
  archive_import: Archive,
  sender: MailCheck,
}

export interface MailThreadEntryItemProps {
  projectId: string
  documentId: string
  threadId: string
  entry: MailThreadEntryView
  versions: readonly DocumentVersionView[] | null
  focused: boolean
  showTrust?: boolean
  onDetach?: (entry: MailThreadEntryView) => void
  client: MailThreadClient
}

export function MailThreadEntryItem({ projectId, documentId, threadId, entry, versions, focused, showTrust = true, onDetach, client }: MailThreadEntryItemProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  const { locale } = useLocale()
  const ref = useRef<HTMLLIElement>(null)
  const [comparison, setComparison] = useState<TextComparison | null>(null)
  const reduceMotion = usePrefersReducedMotion()
  const trust = filedSenderTrust(entry.senderTrust)
  const compared = versions ? comparedVersions(entry, versions) : null
  const ViaIcon = FILED_VIA_ICON[entry.filedVia]
  const attachments = attachmentLines(entry.attachments)
  const heading = headingParts(entry.heading)

  useEffect(() => {
    if (!focused || !ref.current) return
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

  const menu: ActionMenuEntry[] = [
    ...(compared
      ? [{ type: 'item' as const, id: 'compare', label: comparison ? t('entry.compareClose') : t('entry.compare'), onSelect: () => void compare(), testId: 'mail-thread-entry-compare' }]
      : []),
    ...(onDetach ? [{ type: 'item' as const, id: 'detach', label: t('entry.detach'), onSelect: () => onDetach(entry), testId: 'mail-entry-detach' }] : []),
  ]
  const original = <EntryOriginal entry={entry} inline download={() => client.downloadOriginal(projectId, threadId, entry.id)} />
  const originalOnLine = originalState(entry) === 'available'

  const trustLine = (() => {
    if (trust === 'verified') {
      return { Icon: ShieldCheck, words: entry.signerDomain ? t('entry.trust.verified', { domain: entry.signerDomain }) : t('entry.trust.verifiedNoDomain') }
    }
    if (trust === 'unverified') return { Icon: ShieldAlert, words: t('entry.trust.unverified') }
    return { Icon: ShieldQuestion, words: t('entry.trust.notChecked') }
  })()

  return (
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
          {/* The heading as the document prints it. It wraps between its date, name and domain (the space after the
              date stays outside the unbroken date, or there is no place to wrap and the name broke inside a word), never
              inside the date; a long German name hyphenates at a syllable instead of splitting anywhere. */}
          <h4 className="text-foreground text-sm font-medium leading-snug" lang="de" data-testid="mail-thread-entry-heading">
            {heading.when && (
              <>
                <span className="whitespace-nowrap tabular-nums">{heading.when.trimEnd()}</span>{' '}
              </>
            )}
            <span className="hyphens-auto [overflow-wrap:break-word]">{heading.who}</span>
            {/* The space stays outside the block, where a line may break; the parenthesis keeps its domain. */}
            {heading.domain && (
              <>
                {' '}
                <span className="text-muted-foreground inline-block max-w-full font-normal [overflow-wrap:anywhere]">{heading.domain.trimStart()}</span>
              </>
            )}
          </h4>
          <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2.5 text-xs leading-snug">
            <span className="tabular-nums" data-testid="mail-thread-entry-received">
              {t('entry.received', { time: receivedAtLabel(entry, locale) })}
            </span>
            {originalOnLine && original}
          </div>
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
          <ul className="flex flex-col gap-2 pl-5" data-testid="mail-thread-entry-attachments">
            {attachments.map((line) => (
              <AttachmentItem key={line.position} projectId={projectId} line={line} />
            ))}
          </ul>
        </div>
      )}

      {!originalOnLine && original}

      {comparison && (
        <div className="flex flex-col gap-2" data-testid="mail-thread-entry-comparison" data-state={comparison.status}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-muted-foreground text-xs font-medium">{t('entry.compare')}</p>
            <Button
              type="button"
              variant="inline"
              className="touch-target h-auto p-0 text-xs"
              aria-label={t('entry.compareCloseLabel', { heading: entry.heading })}
              onClick={() => setComparison(null)}
              data-testid="mail-thread-entry-compare-close"
            >
              {t('entry.compareClose')}
            </Button>
          </div>
          <TextComparisonView comparison={comparison} />
        </div>
      )}
    </Item>
  )
}

const NOTE_UNDER_ITS_FILE = 'text-muted-foreground pl-[18px]'

function AttachmentItem({ projectId, line }: { projectId: string; line: AttachmentLine }): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  if (line.kind === 'hidden') {
    return (
      <li className="flex min-w-0 flex-col gap-0.5 text-xs leading-snug" data-testid="mail-thread-attachment" data-disposition="hidden">
        <span className="text-muted-foreground flex min-w-0 items-center gap-1">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          {t('attachments.hiddenName')}
        </span>
        <span className={NOTE_UNDER_ITS_FILE}>{t('attachments.hidden')}</span>
      </li>
    )
  }
  const name = line.name || t('attachments.unnamed')
  const named =
    line.kind !== 'not_filed' && line.documentId ? (
      <Link
        href={documentFilesHref(projectId, line.documentId)}
        className="text-foreground decoration-foreground/40 hover:decoration-foreground rounded-inline flex min-h-6 min-w-0 max-w-full items-center gap-1 underline underline-offset-[3px] outline-none transition-colors duration-quick ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
        data-testid="mail-thread-attachment-link"
      >
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <FittedName text={name} className="flex-1" />
      </Link>
    ) : (
      <span className="flex min-w-0 max-w-full items-center gap-1">
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <FittedName text={name} className="flex-1" />
      </span>
    )
  return (
    // A file's name is one line in a row, cut in its middle with the whole of it as its title (`FittedName`): broken
    // over three lines it carried three underlines, and the only words broken anywhere are a file's.
    <li className="flex min-w-0 flex-col gap-0.5 text-xs leading-snug" data-testid="mail-thread-attachment" data-disposition={line.kind}>
      {named}
      {line.kind !== 'not_filed' && line.folderPath !== null && (
        <span className="text-muted-foreground flex min-w-0 items-start gap-1 pl-[18px]" data-testid="mail-thread-attachment-folder">
          <Folder className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {line.folderPath === '' ? t('attachments.root') : line.folderPath}
          </span>
        </span>
      )}
      {line.kind === 'already_present' && <span className={NOTE_UNDER_ITS_FILE}>{t('attachments.alreadyPresent')}</span>}
      {line.kind === 'not_filed' && (
        <span className={NOTE_UNDER_ITS_FILE}>
          {t('attachments.notFiled', { reason: line.reason ? t(`attachments.reasons.${line.reason}`) : t('attachments.inOriginal') })}
        </span>
      )}
    </li>
  )
}

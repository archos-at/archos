'use client'

import type { JSX, KeyboardEvent, RefObject } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Info, ShieldAlert } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ItemList } from '@/components/ui/item'
import { useShortcutsPreference } from '@/hooks/use-shortcuts-preference'
import { useTranslations } from '@/i18n'
import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { CLAUSE_JOIN } from '@/lib/format'
import { displaySubject } from '@/lib/inbound-mail/subject'
import { cn } from '@/lib/utils'
import { attachmentCase } from '../lib/attachment-case'
import {
  checkAllAttachments,
  checkedAttachmentIds,
  fileCheckedInto,
  selectableAttachmentIds,
  sameSubjectThread,
  chooseRevision,
  targetForPath,
  updateAttachment,
  updateMessage,
  type DraftCopy,
  type DraftSummary,
  type FolderOption,
  type MailDraft,
} from '../lib/draft'
import { fileAllInto, filesAnything, keptWithoutFolder, planLines, quickPicks, type FilingStep, type MissingSuggestion, type PlanLine, type QuickPick } from '../lib/filing-plan'
import { senderFolderPicks, senderMemoryReason } from '../lib/sender-folders'
import { followOffered, mailClaimOf, senderDisplayName } from '../lib/sender'
import { AttachmentRow } from './attachment-row'
import { AttachmentsHeading } from './attachments-heading'
import { blockerText } from './decision-bar'
import { DETAIL_PANEL } from './detail-skeleton'
import { FolderChoice } from './folder-choice'
import { FollowLine } from './follow-line'
import { CheckLine, FactLine } from './inbound-mail-atoms'
import { MessageRow } from './message-row'
import { usePlanWords } from './plan-words'
import { SenderFlagLines, SenderTrustLine } from './sender-trust'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FilingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: readonly FilingStep[]
  step: FilingStep
  onStep: (step: FilingStep) => void
  onAddStep: (step: FilingStep) => void
  projectId: string
  view: InboundMailView
  draft: MailDraft
  onDraft: (update: (draft: MailDraft) => MailDraft) => void
  summary: DraftSummary
  folders: readonly FolderOption[]
  copy: DraftCopy
  missing: MissingSuggestion
  openIds: readonly string[]
  pickIds: readonly string[]
  threadNameStop: string[] | null
  /** „Doch ablegen“ on a part „Übersicht“ leaves out: it is filed after all, and asked about where it still needs an answer. */
  onInclude: (partId: string) => void
  impersonation: boolean
  contentUrlOf: (partId: string) => string | null
  onPreview: (partId: string, trigger: HTMLElement) => void
  filing: boolean
  onFile: () => void
  onDismiss: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function FilingDialog({
  open,
  onOpenChange,
  steps,
  step,
  onStep,
  onAddStep,
  projectId,
  view,
  draft,
  onDraft,
  summary,
  folders,
  copy,
  missing,
  openIds,
  pickIds,
  threadNameStop,
  onInclude,
  impersonation,
  contentUrlOf,
  onPreview,
  filing,
  onFile,
  onDismiss,
  returnFocusRef,
}: FilingDialogProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const words = usePlanWords()
  const { enabled: shortcuts } = useShortcutsPreference()
  const blockersId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [restOpen, setRestOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const index = Math.max(0, steps.indexOf(step))
  const last = step === 'overview'
  const claim = mailClaimOf(view)
  const follows = followOffered(view) && !view.followedBy

  const lines = useMemo(() => planLines(view, draft, copy), [view, draft, copy])
  const blockers = summary.blockers.map((blocker) => blockerText(blocker, t, summary, impersonation)).filter((text): text is string => text !== null)
  const nothing = !filesAnything(lines)
  const blocked = !nothing && summary.blockers.length > 0
  const senderUnconfirmed = step === 'sender' && summary.needsSenderAcknowledgement && !draft.acknowledgeSender
  const isLeft = (line: PlanLine): boolean => line.kind === 'left' || line.kind === 'text_left'
  const kept = lines.filter((line) => !isLeft(line))
  const left = lines.filter(isLeft)
  const unplaced = step === 'attachments' ? keptWithoutFolder(view, draft) : 0
  const nameMissing = step === 'text' && summary.blockers.some((blocker) => blocker.kind === 'thread_name_missing')
  const stepHold = senderUnconfirmed ? null : unplaced > 0 ? t('filing.attachments.waitsForFolder', { count: unplaced }) : nameMissing ? t('bar.blockers.thread_name_missing') : null
  const holdId = useId()

  const [whereOnly, setWhereOnly] = useState(true)
  useEffect(() => {
    if (!open) return
    setRestOpen(openIds.length === 0)
    setWhereOnly(openIds.every((id) => pickIds.includes(id) && draft.attachments.some((row) => row.partId === id && row.checked)))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per opening; the draft changes as the person answers
  }, [open, openIds, pickIds])

  const shown = useRef<FilingStep | null>(null)
  useEffect(() => {
    if (!open) {
      shown.current = null
      return
    }
    const first = shown.current === null
    if (shown.current === step) return
    shown.current = step
    bodyRef.current?.scrollTo?.({ top: 0 })
    if (!first) titleRef.current?.focus({ preventScroll: true })
  }, [open, step])

  const say = (text: string): void => {
    setAnnouncement('')
    window.setTimeout(() => setAnnouncement(text), 30)
  }

  const file = (): void => {
    if (filing) return
    if (nothing) return onDismiss()
    if (blocked) return say(blockers[0] ?? '')
    onFile()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'e' || !last || !shortcuts || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return
    if (target.isContentEditable || TYPING.has(target.tagName)) return
    event.preventDefault()
    file()
  }

  const attachments = view.parts.filter((part) => part.kind === 'attachment' && part.state === 'waiting').map((part) => attachmentCase(part, view))
  const rest = attachments.filter((entry) => !openIds.includes(entry.part.id))
  const shownRows = restOpen ? attachments : attachments.filter((entry) => openIds.includes(entry.part.id))
  const question = ((): { title: string; hint: string | null } => {
    switch (step) {
      case 'sender': {
        if (summary.ownClaimedMail) return { title: t('filing.sender.questionOwn'), hint: t('filing.sender.hintOwn') }
        if (impersonation) return { title: t('filing.sender.questionImpersonation'), hint: t('filing.sender.hintImpersonation') }
        if (summary.claimedWriter) {
          return { title: t('filing.sender.questionClaimed', { name: summary.claimedWriter }), hint: t('filing.sender.hintClaimed', { name: summary.claimedWriter }) }
        }
        return { title: t('filing.sender.question'), hint: t('filing.sender.hint') }
      }
      case 'text': {
        const part = view.parts.find((candidate) => candidate.kind === 'message')
        const unsure = view.threadCandidates.length > 0 && !view.threadCandidates.some((candidate) => candidate.preselected && candidate.blocks.length === 0)
        const bySubject = sameSubjectThread(view)
        const hint =
          part && part.contentFindings.length > 0
            ? t('filing.text.hintFinding')
            : bySubject
              ? t('filing.text.hintSubject', { name: bySubject.name })
              : unsure
                ? t('filing.text.hintUnsure')
                : t('filing.text.hint')
        return { title: t('filing.text.question'), hint }
      }
      case 'attachments': {
        const ticks = shownRows.some((entry) => !entry.unsureRevision) ? t('filing.attachments.hint') : null
        return openIds.length === 0
          ? { title: t('filing.attachments.questionAll'), hint: ticks }
          : whereOnly
            ? { title: t('filing.attachments.question', { count: openIds.length }), hint: ticks }
            : { title: t('filing.attachments.questionWhat', { count: openIds.length }), hint: ticks }
      }
      case 'overview':
        return { title: t('filing.overview.question'), hint: null }
    }
  })()

  const selectableIds = selectableAttachmentIds(view)
  const checkedIds = checkedAttachmentIds(draft, view)
  const senderPicks = useMemo<QuickPick[]>(
    () =>
      senderFolderPicks(view, { pick: (count, name) => t('senderMemory.pick', { count, name }) }).map((pick) => ({
        target: targetForPath(pick.path, folders, pick.folderId),
        why: 'sender',
        of: pick.reason,
      })),
    [view, folders, t]
  )
  const picks = useMemo(() => quickPicks(view, draft, pickIds, folders, copy, { extra: senderPicks }), [view, draft, pickIds, folders, copy, senderPicks])
  const pickedFolders = draft.attachments.filter((row) => pickIds.includes(row.partId) && row.checked).map((row) => row.folder)
  const sharedFolder =
    pickedFolders.length > 0 && pickedFolders.every((folder) => folder !== null && folder.path === pickedFolders[0]?.path) ? (pickedFolders[0] ?? null) : null

  const attachmentRows = (entries: typeof attachments): JSX.Element => (
    <ItemList as="ul" data-surface="sunken" className={DETAIL_PANEL}>
      {entries.map((entry) => {
        const row = draft.attachments.find((candidate) => candidate.partId === entry.part.id)
        if (!row) return null
        const url = entry.previewable ? contentUrlOf(entry.part.id) : null
        return (
          <AttachmentRow
            key={entry.part.id}
            projectId={projectId}
            entry={entry}
            draft={row}
            folders={folders}
            contentUrl={url}
            missingSuggestion={missing}
            folderBelow={pickIds.includes(entry.part.id) ? (pickIds.length > 1 ? 'shared' : 'only') : false}
            folderPicks={quickPicks(view, draft, [entry.part.id], folders, copy, { extra: senderPicks })}
            suggestionLabel={senderMemoryReason(view, entry.part, { suggestion: (name) => t('senderMemory.suggestion', { name }) }) ?? undefined}
            onChange={(change) => onDraft((current) => updateAttachment(current, entry.part.id, change))}
            onRevisionChoice={(choice) => onDraft((current) => chooseRevision(current, view, entry.part.id, choice, folders))}
            onPreview={url ? (trigger) => onPreview(entry.part.id, trigger) : undefined}
          />
        )
      })}
    </ItemList>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenOnMobile
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 phone:pb-[env(safe-area-inset-bottom)] phone:pt-[env(safe-area-inset-top)] sm:max-w-xl"
        closeLabel={t('filing.cancel')}
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          if (step !== 'overview' || !primaryRef.current) return
          event.preventDefault()
          primaryRef.current.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current?.isConnected) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
        data-testid="filing-dialog"
        data-step={step}
      >
        <DialogHeader className="gap-1 px-6 pb-3 pt-6 pr-14">
          <p className="text-muted-foreground flex min-w-0 items-baseline gap-1 text-xs" data-testid="filing-mail">
            {steps.length > 1 && (
              <span className="shrink-0 tabular-nums" data-testid="filing-progress">
                {`${t('filing.progress', { current: index + 1, total: steps.length })}${CLAUSE_JOIN}`}
              </span>
            )}
            <span className="text-foreground min-w-0 truncate font-medium">{t('filing.mailSubject', { subject: displaySubject(view.subject) ?? t('row.noSubject') })}</span>
            {view.sender && <span className="shrink-0">{` ${t('filing.mailFrom', { sender: senderDisplayName(view.sender) })}`}</span>}
          </p>
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-pane-title leading-snug outline-none [overflow-wrap:anywhere]">
            {question.title}
          </DialogTitle>
          {question.hint ? <DialogDescription className="text-sm">{question.hint}</DialogDescription> : <DialogDescription className="sr-only">{t('filing.title')}</DialogDescription>}
        </DialogHeader>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-2">
          {step === 'sender' && view.sender && (
            <section className="flex flex-col gap-4" data-testid="filing-step-sender">
              <div className="flex flex-col gap-1">
                <span className="text-foreground text-sm [overflow-wrap:anywhere]">
                  {senderDisplayName(view.sender)} <span className="text-muted-foreground">{view.sender.address}</span>
                </span>
                <SenderTrustLine sender={view.sender} impersonation={view.impersonation} claim={claim} />
              </div>
              <SenderFlagLines sender={view.sender} />
              <CheckLine checked={draft.acknowledgeSender} onCheckedChange={(value) => onDraft((current) => ({ ...current, acknowledgeSender: value }))} disabled={filing} testId="acknowledge-sender" className="text-sm">
                <span className="text-foreground inline-flex items-start gap-1.5 font-medium">
                  <ShieldAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                  {/* What the person affirms, never „… Ablegen“: a box ending in the verb read as if ticking filed. */}
                  {summary.claimedWriter
                    ? t('bar.acknowledgeClaimedMail', { name: summary.claimedWriter })
                    : t(summary.ownClaimedMail ? 'bar.acknowledgeOwnMail' : impersonation ? 'bar.acknowledgeImpersonation' : 'bar.acknowledgeSender')}
                </span>
              </CheckLine>
            </section>
          )}

          {step === 'text' && draft.message && (
            <section data-testid="filing-step-text">
              <ItemList data-surface="sunken" className={DETAIL_PANEL}>
                <MessageRow
                  projectId={projectId}
                  view={view}
                  draft={draft.message}
                  folders={folders}
                  copy={copy}
                  threadNameStop={threadNameStop}
                  onChange={(change) => onDraft((current) => updateMessage(current, change))}
                />
              </ItemList>
            </section>
          )}

          {step === 'attachments' && (
            <section className="flex flex-col gap-2" data-testid="filing-step-attachments">
              {restOpen && selectableIds.length >= 2 && (
                <AttachmentsHeading
                  bulk
                  selectable={selectableIds.length}
                  checked={checkedIds.length}
                  folders={folders}
                  onCheckAll={(checked) => onDraft((current) => checkAllAttachments(current, view, checked))}
                  onFileCheckedInto={(target) => {
                    const result = fileCheckedInto(draft, view, target)
                    onDraft(() => result.draft)
                    const place = target.path === '' ? t('suggestion.root') : target.path
                    const moved = t('attachments.movedInto', { count: result.moved, folder: place })
                    say(result.revisions > 0 ? `${moved} ${t('attachments.movedKeptRevisions', { count: result.revisions })}` : moved)
                  }}
                />
              )}
              {shownRows.length > 0 && attachmentRows(shownRows)}
              {pickIds.length > 0 && (
                <FolderChoice
                  foldAfterChoice
                  count={pickIds.length}
                  current={sharedFolder}
                  picks={picks}
                  folders={folders}
                  onPick={(target) => {
                    const result = fileAllInto(draft, pickIds, target)
                    onDraft(() => result.draft)
                    say(t('attachments.movedInto', { count: result.moved, folder: target.path === '' ? t('suggestion.root') : target.path }))
                  }}
                />
              )}
              {rest.length > 0 && openIds.length > 0 && (
                <Button
                  type="button"
                  variant="inline"
                  className="text-muted-foreground touch-target h-auto self-start p-0 text-sm"
                  aria-expanded={restOpen}
                  onClick={() => setRestOpen((value) => !value)}
                  data-testid="filing-rest-toggle"
                >
                  {restOpen ? (
                    t('filing.attachments.restHide')
                  ) : (
                    <>
                      {t('filing.attachments.rest', { count: rest.length })}
                      <span className="text-foreground font-medium">{`${CLAUSE_JOIN}${t('filing.attachments.restShow')}`}</span>
                    </>
                  )}
                  <ChevronDown className={cn('size-3.5 transition-transform duration-quick motion-reduce:transition-none', restOpen && 'rotate-180')} aria-hidden />
                </Button>
              )}
            </section>
          )}

          {step === 'overview' && (
            <section className="flex flex-col gap-4" data-testid="filing-step-overview">
              {kept.length > 0 && (
                <ul className="flex flex-col gap-3" data-testid="filing-overview">
                  {kept.map((line) => (
                    <li key={line.partId} className="text-sm leading-snug [overflow-wrap:anywhere]" data-testid="filing-overview-line" data-kind={line.kind}>
                      <span className="text-foreground font-medium">{words.subject(line)}</span>{' '}
                      <span className={cn('text-foreground', line.kind === 'no_folder' && 'font-medium')}>{words.outcome(line)}</span>
                      {(line.kind === 'text_append' || line.kind === 'text_create') && follows && draft.message && (
                        <FollowLine
                          follow={draft.message.follow}
                          onFollow={(follow) => {
                            onDraft((current) => updateMessage(current, { follow }))
                            say(follow ? t('filing.overview.followOn') : t('filing.overview.followOff'))
                          }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {left.length > 0 && (
                <div className="border-edge flex flex-col gap-2.5 rounded-control border px-3 py-3" data-testid="filing-left">
                  <ul className="flex flex-col gap-2.5">
                    {left.map((line) => (
                      <li key={line.partId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm leading-snug" data-testid="filing-overview-line" data-kind={line.kind}>
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="text-foreground font-medium">{words.subject(line)}</span> <span className="text-foreground">{words.outcome(line)}</span>
                        </span>
                        {(line.kind === 'left' || line.kind === 'text_left') && line.includable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="shrink-0 px-2.5 text-xs"
                            onClick={() => {
                              onInclude(line.partId)
                              say(t('filing.overview.included', { name: words.subject(line) }))
                            }}
                            disabled={filing}
                            data-testid="filing-include"
                          >
                            {t('filing.overview.include')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!nothing && (
                    <p className="text-foreground text-xs leading-snug" data-testid="filing-left-note">
                      {t('filing.overview.leftNote', { days: INBOUND_MAIL_RESTORE_DAYS })}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {lines.some((line) => line.kind.startsWith('text')) && view.parts.some((part) => part.kind === 'message' && part.state === 'waiting') && draft.message && (
                  <Button type="button" variant="inline" className="touch-target h-auto p-0 text-sm" onClick={() => onAddStep('text')} data-testid="filing-change-text">
                    {t('filing.overview.changeText')}
                  </Button>
                )}
                {selectableIds.length > 0 && (
                  <Button type="button" variant="inline" className="touch-target h-auto p-0 text-sm" onClick={() => onAddStep('attachments')} data-testid="filing-change-attachments">
                    {t('filing.overview.changeAttachments')}
                  </Button>
                )}
              </div>
              {nothing && (
                <FactLine icon={Info} testId="filing-nothing">
                  {t('filing.overview.nothing')}
                </FactLine>
              )}
              {blocked && (
                <div id={blockersId} className="flex flex-col gap-1" data-testid="filing-blockers">
                  {blockers.map((text) => (
                    <FactLine key={text} icon={AlertTriangle} tone="warning" testId="decision-blocker">
                      {text}
                    </FactLine>
                  ))}
                </div>
              )}
            </section>
          )}
          <p role="status" aria-live="polite" className="sr-only" data-testid="filing-announcement">
            {announcement}
          </p>
        </div>

        <DialogFooter className="shadow-pinned-foot z-[1] gap-2 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:justify-between sm:pb-5">
          {index === 0 ? (
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="filing-cancel">
              {t('filing.cancel')}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => onStep(steps[index - 1])} disabled={filing} data-testid="filing-back">
              {t('filing.back')}
            </Button>
          )}
          {stepHold && !last && (
            <p id={holdId} className="text-foreground order-first flex items-start gap-1.5 text-xs sm:order-none sm:ml-auto sm:self-center" data-testid="filing-step-hold">
              <Info className="text-muted-foreground mt-px size-3.5 shrink-0" aria-hidden />
              {stepHold}
            </p>
          )}
          {last ? (
            <BusyButton
              ref={primaryRef}
              type="button"
              busy={filing}
              busyLabel={t('bar.busy')}
              onClick={file}
              disabled={blocked}
              aria-describedby={blocked ? blockersId : undefined}
              data-testid="decision-file"
            >
              {/* The forged mail's yes has its own verb: „Ablegen“ read as every other filing. */}
              {nothing ? t('bar.dismiss') : impersonation && !summary.ownClaimedMail ? t('bar.fileGenuine') : t('bar.file')}
            </BusyButton>
          ) : (
            <Button
              type="button"
              onClick={() => onStep(steps[index + 1])}
              disabled={senderUnconfirmed || stepHold !== null}
              aria-describedby={stepHold ? holdId : undefined}
              data-testid="filing-next"
            >
              {t('filing.next')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

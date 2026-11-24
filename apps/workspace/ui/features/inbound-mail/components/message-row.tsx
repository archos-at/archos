'use client'

import type { JSX } from 'react'
import { useId, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Folder, Mail, ShieldAlert, ShieldQuestion, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewMark } from '@/components/ui/filing-chip'
import { Input } from '@/components/ui/input'
import { Item } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { FolderPickerSheet } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { INBOUND_MAIL_FILE_NAME_MAX, type InboundMailThreadCandidateView, type InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { INBOUND_MAIL_STALE_DATE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { CLAUSE_JOIN } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  appendNeedsAcknowledgement,
  messageSelectable,
  newThreadTarget,
  targetForPath,
  type DraftCopy,
  type FolderOption,
  type MessageDraft,
  type MessageTarget,
} from '../lib/draft'
import { FiledTo } from './filed-to'
import { ContentFindingChoice } from './content-finding-choice'
import { CheckLine, FactLine, PlaceFact } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const NEW_THREAD = 'new'
const LEAVE = 'leave'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Why a Verlauf is offered, in the reader's words: what links the mail to it, and any doubt about that link. */
function candidateWhy(candidate: InboundMailThreadCandidateView, t: Translate): string {
  const doubts = candidate.blocks.filter((block) => block !== 'weak_match')
  if (doubts.length > 0) return doubts.map((block) => t(`message.blocks.${block}`, { days: INBOUND_MAIL_STALE_DATE_DAYS })).join(CLAUSE_JOIN)
  return candidate.strength === 'subject' || candidate.blocks.includes('weak_match') ? t('message.why.subject') : t('message.why.reply')
}

export interface MessageRowProps {
  projectId: string
  view: InboundMailView
  draft: MessageDraft
  folders: readonly FolderOption[]
  copy: DraftCopy
  threadNameStop: string[] | null
  onChange: (change: Partial<Omit<MessageDraft, 'partId'>>) => void
}

/** Why the text cannot be filed, or need not be: unreadable, the mail's own scan, already in its E-Mail-Verlauf. */
export function MessageFacts({ view }: { view: InboundMailView }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const part = view.parts.find((candidate) => candidate.kind === 'message')
  const unreadable = part?.riskFlags.includes('unreadable') ?? false
  const alreadyFiled = view.sender?.flags.includes('already_filed') ?? false
  if (!unreadable && view.rawScan === 'clean' && !alreadyFiled) return null
  return (
    <div className="flex flex-col gap-1" data-testid="message-facts">
      {unreadable && (
        <FactLine icon={AlertTriangle} tone="warning">
          {t('message.unreadable')}
        </FactLine>
      )}
      {view.rawScan === 'infected' && (
        <FactLine icon={ShieldAlert} tone="danger" testId="message-scan-infected">
          {t('message.rawScan.infected')}
        </FactLine>
      )}
      {view.rawScan === 'failed' && (
        <FactLine icon={ShieldQuestion} tone="warning" testId="message-scan-failed">
          {t('message.rawScan.failed')}
        </FactLine>
      )}
      {view.rawScan === 'pending' && (
        <FactLine icon={Timer} testId="message-scan-pending">
          {t('message.rawScan.pending')}
        </FactLine>
      )}
      {alreadyFiled && <FactLine icon={CheckCircle2}>{t('message.alreadyFiled')}</FactLine>}
    </div>
  )
}

export function MessageRow({ projectId, view, draft, folders, copy, threadNameStop, onChange }: MessageRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const id = useId()
  const [pickerOpen, setPickerOpen] = useState(false)
  const part = view.parts.find((candidate) => candidate.kind === 'message')
  const selectable = messageSelectable(view)
  const target = draft.target
  const candidates = view.threadCandidates
  const chosen = target.kind === 'append' ? candidates.find((candidate) => candidate.threadId === target.threadId) : undefined
  const destinations = useMemo(
    () =>
      folders
        .filter((folder) => folder.writable)
        .map((folder) => ({ folder: { id: folder.id, name: folder.name, parentId: folder.parentId }, label: folder.path.split('/').join(' / ') })),
    [folders]
  )

  if (part && part.state !== 'waiting') {
    return (
      <Item className="items-start px-4" data-testid="message-row" data-status={part.state}>
        <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">{t('message.label')}</p>
          {part.state === 'filed' ? (
            <FiledTo projectId={projectId} part={part} followed={view.followedBy !== null} />
          ) : (
            <FactLine icon={Mail}>{t(`attachments.status.${part.state}`)}</FactLine>
          )}
        </div>
      </Item>
    )
  }

  const choose = (value: string): void => {
    if (value === LEAVE) return onChange({ checked: false })
    if (value === NEW_THREAD) {
      return onChange({ checked: true, target: target.kind === 'create' ? target : newThreadTarget(view, folders, copy), acknowledgeThread: false })
    }
    const candidate = candidates.find((entry) => entry.threadId === value)
    // Picking a match the server could not confirm, its doubt in the label, is the person's yes to it.
    onChange({ checked: true, target: { kind: 'append', threadId: value }, acknowledgeThread: !!candidate && appendNeedsAcknowledgement(candidate) })
  }
  const proposedFolder = target.kind === 'create' ? target.folder : (newThreadTarget(view, folders, copy) as Extract<MessageTarget, { kind: 'create' }>).folder
  const newFolderPlace = proposedFolder.path === '' ? t('suggestion.root') : proposedFolder.path
  const chosenValue = !selectable || !draft.checked ? LEAVE : target.kind === 'append' ? target.threadId : NEW_THREAD

  return (
    <Item className="items-start px-4" data-testid="message-row" data-checked={draft.checked || undefined}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <MessageFacts view={view} />
        {selectable && (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">{t('message.choiceLabel')}</legend>
            <RadioGroup value={chosenValue} onValueChange={choose} className="gap-3" data-testid="message-choice">
              {candidates.map((candidate) => (
                <div key={candidate.threadId} className="flex items-start gap-2 pointer-coarse:min-h-11" data-testid={`thread-candidate-${candidate.threadId}`}>
                  <RadioGroupItem id={`${id}-${candidate.threadId}`} value={candidate.threadId} disabled={candidate.full} className="mt-0.5" />
                  <Label htmlFor={`${id}-${candidate.threadId}`} className={cn('flex flex-col items-start gap-0.5 font-normal', candidate.full && 'opacity-60')}>
                    <span className="text-foreground text-sm [overflow-wrap:anywhere]">{t('message.append', { name: candidate.name })}</span>
                    <span className="text-muted-foreground text-xs leading-snug" data-testid="thread-candidate-why">
                      {candidate.full ? t('message.full') : candidateWhy(candidate, t)}
                    </span>
                  </Label>
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2 pointer-coarse:min-h-11">
                  <RadioGroupItem id={`${id}-new`} value={NEW_THREAD} className="mt-0.5" data-testid="thread-new" />
                  <Label htmlFor={`${id}-new`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="text-foreground text-sm">{t('message.create')}</span>
                    {!(draft.checked && target.kind === 'create') && (
                      <span className="text-muted-foreground text-xs leading-snug">{t('message.createWhere', { folder: newFolderPlace })}</span>
                    )}
                  </Label>
                </div>
                {draft.checked && target.kind === 'create' && (
                  <div className="flex flex-col gap-2 pl-6" data-testid="thread-create">
                    <Label htmlFor={`${id}-name`} className="text-xs">
                      {t('message.nameLabel')}
                    </Label>
                    <Input
                      id={`${id}-name`}
                      value={target.name}
                      maxLength={INBOUND_MAIL_FILE_NAME_MAX}
                      onChange={(event) => onChange({ target: { ...target, name: event.target.value } })}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="pointer-coarse:text-base"
                      aria-invalid={target.name.trim() === '' || undefined}
                      data-testid="thread-name"
                    />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <PlaceFact icon={Folder} label={t('message.folderLabel')} testId="detail-new-thread-folder">
                        {target.folder.path === '' ? t('suggestion.root') : target.folder.path}
                        {target.folder.kind === 'new' && <NewMark className="ml-1.5 align-[1px]">{t('suggestion.newFolder')}</NewMark>}
                      </PlaceFact>
                      <Button type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setPickerOpen(true)} data-testid="detail-new-thread-folder-change">
                        {t('message.folderChange')}
                      </Button>
                    </div>
                    {threadNameStop && (
                      <>
                        <FactLine icon={AlertTriangle} tone="warning" testId="thread-name-stop">
                          {threadNameStop.length > 0 ? t('message.nameStop', { terms: threadNameStop.join('“, „') }) : t('refusals.name_stop')}
                        </FactLine>
                        <CheckLine
                          checked={target.releaseName}
                          onCheckedChange={(releaseName) => onChange({ target: { ...target, releaseName } })}
                          testId="thread-release-name"
                        >
                          {t('message.releaseName')}
                        </CheckLine>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2 pointer-coarse:min-h-11">
                <RadioGroupItem id={`${id}-leave`} value={LEAVE} className="mt-0.5" data-testid="thread-leave" />
                <Label htmlFor={`${id}-leave`} className="flex flex-col items-start gap-0.5 font-normal">
                  <span className="text-foreground text-sm">{t('message.leave')}</span>
                  <span className="text-muted-foreground text-xs leading-snug">{t('message.leaveHint')}</span>
                </Label>
              </div>
            </RadioGroup>
          </fieldset>
        )}
        {view.hiddenThreadCandidates > 0 && selectable && (
          <p className="text-foreground text-xs leading-snug" data-testid="thread-hidden">
            {t('message.hidden', { count: view.hiddenThreadCandidates })}
          </p>
        )}

        {selectable && draft.checked && chosen && appendNeedsAcknowledgement(chosen) && !draft.acknowledgeThread && (
          <CheckLine checked={draft.acknowledgeThread} onCheckedChange={(acknowledgeThread) => onChange({ acknowledgeThread })} testId="thread-acknowledge">
            {t('message.acknowledge')}
          </CheckLine>
        )}

        {selectable && draft.checked && part && part.contentFindings.length > 0 && draft.findingChoice && (
          <ContentFindingChoice
            findings={part.contentFindings}
            value={draft.findingChoice}
            onChange={(findingChoice) => onChange({ findingChoice })}
            appendTo={chosen?.name ?? null}
          />
        )}
      </div>
      <FolderPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t('target.folderPickerTitle')}
        destinations={destinations}
        currentFolderId={target.kind === 'create' && target.folder.kind === 'existing' ? target.folder.folderId : undefined}
        onPick={(folderId) => {
          setPickerOpen(false)
          if (target.kind !== 'create') return
          const folder = folderId ? folders.find((option) => option.id === folderId) : null
          onChange({ target: { ...target, folder: folder ? targetForPath(folder.path, folders, folder.id) : targetForPath('', folders), folderSuggested: false } })
        }}
      />
    </Item>
  )
}

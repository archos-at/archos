'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Check, FileStack, FolderInput, FolderPlus, History, Paperclip } from 'lucide-react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SectionLabel } from '@/components/ui/section-label'
import { FolderPickerList, NewFolderDialog, PickerRow } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { CLAUSE_JOIN } from '@/lib/format'
import { targetForPath, type FolderOption, type FolderTarget } from '../lib/draft'
import type { QuickPick } from '../lib/filing-plan'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const AgentIcon = (props: { className?: string }): JSX.Element => <AgentGlyph size="xs" className={props.className} />

export interface FolderChoiceProps {
  /** How many attachments one pick sends: two or more read „Alle {n} in diesen Ordner“. */
  count: number
  /** The folder every one of them already goes to, if they share one. */
  current: FolderTarget | null
  picks: readonly QuickPick[]
  folders: readonly FolderOption[]
  onPick: (target: FolderTarget) => void
  label?: string | null
  listClassName?: string
  foldAfterChoice?: boolean
}

/** The folder question answered in place: a few likely folders first, a new one, then the project's folders to search. */
export function FolderChoice({
  count,
  current,
  picks,
  folders,
  onPick,
  label,
  listClassName = 'max-h-[min(32dvh,15rem)]',
  foldAfterChoice = false,
}: FolderChoiceProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [creating, setCreating] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const destinations = useMemo(
    () =>
      folders
        .filter((folder) => folder.writable)
        .map((folder) => ({ folder: { id: folder.id, name: folder.name, parentId: folder.parentId }, label: folder.path.split('/').join(' / ') })),
    [folders]
  )
  const place = (target: FolderTarget): string => (target.path === '' ? t('suggestion.root') : target.path.split('/').join(' / '))
  const here = (target: FolderTarget): boolean => current !== null && current.path === target.path
  const hint = (pick: QuickPick): string => {
    const base =
      pick.why === 'suggestion' ? t('suggestion.label') : pick.why === 'sender' ? (pick.of ?? '') : t(`filing.attachments.quick.${pick.why}`, { name: pick.of ?? '' })
    return pick.target.kind === 'new' ? `${base}${CLAUSE_JOIN}${t('suggestion.newFolder')}` : base
  }
  const heading = label === undefined ? (count > 1 ? t('filing.attachments.pickAll', { count }) : t('filing.attachments.pickOne')) : label
  const choose = (target: FolderTarget): void => {
    setBrowsing(false)
    onPick(target)
  }
  if (foldAfterChoice && current !== null && !browsing) {
    return (
      <section className="border-edge flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control border px-3 py-2" data-testid="filing-folder-choice" data-chosen={current.path}>
        <p className="text-foreground flex min-w-0 items-center gap-2 text-sm">
          <Check className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {t(count > 1 ? 'filing.attachments.chosenAll' : 'filing.attachments.chosenOne', { count, folder: place(current) })}
          </span>
        </p>
        <Button type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setBrowsing(true)} data-testid="filing-folder-other">
          <FolderInput className="size-3.5" aria-hidden />
          {t('filing.attachments.otherFolder')}
        </Button>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-2" data-testid="filing-folder-choice" aria-label={heading ?? t('filing.attachments.pickOne')}>
      {heading && <SectionLabel as="h3">{heading}</SectionLabel>}
      <ul className="-mx-2" aria-label={t('filing.attachments.quick.label')} data-testid="filing-quick-picks">
        {picks.map((pick) => (
          <PickerRow
            key={pick.target.path}
            label={place(pick.target)}
            hint={hint(pick)}
            icon={pick.why === 'suggestion' ? AgentIcon : pick.target.kind === 'new' ? FolderPlus : pick.why === 'revision' ? FileStack : pick.why === 'sender' ? History : Paperclip}
            here={here(pick.target)}
            disabled={here(pick.target)}
            current="chosen"
            onPick={() => choose(pick.target)}
            testId={`filing-quick-pick-${pick.why}`}
          />
        ))}
        <PickerRow label={t('filing.attachments.newFolder')} icon={FolderPlus} here={false} disabled={false} onPick={() => setCreating(true)} testId="filing-new-folder" />
      </ul>
      <FolderPickerList
        destinations={destinations}
        currentFolderId={current?.kind === 'existing' ? current.folderId : undefined}
        listClassName={listClassName}
        current="chosen"
        onPick={(folderId) => {
          const folder = folderId ? folders.find((option) => option.id === folderId) : null
          choose(folder ? targetForPath(folder.path, folders, folder.id) : targetForPath('', folders))
        }}
      />
      <NewFolderDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(name) => {
          choose(targetForPath(name, folders))
          return Promise.resolve(true)
        }}
      />
    </section>
  )
}

export function FolderChoiceDialog({
  open,
  onOpenChange,
  title,
  current,
  picks,
  folders,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  current: FolderTarget | null
  picks: readonly QuickPick[]
  folders: readonly FolderOption[]
  onPick: (target: FolderTarget) => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md" data-testid="folder-choice-dialog">
        <DialogHeader>
          <DialogTitle className="pr-10 text-base leading-snug [overflow-wrap:anywhere]">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {open && (
          <FolderChoice
            count={1}
            current={current}
            picks={picks}
            folders={folders}
            label={null}
            listClassName="max-h-[min(45dvh,20rem)]"
            onPick={(target) => {
              onOpenChange(false)
              onPick(target)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

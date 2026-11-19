'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { FileStack, FolderPlus, Paperclip } from 'lucide-react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { SectionLabel } from '@/components/ui/section-label'
import { FolderPickerList, PickerRow } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { CLAUSE_JOIN } from '@/lib/format'
import { targetForPath, type FolderOption, type FolderTarget } from '../lib/draft'
import type { QuickPick } from '../lib/filing-plan'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const AgentIcon = (props: { className?: string }): JSX.Element => <AgentGlyph size="xs" className={props.className} />

/** The folder question answered in place: a few likely folders first, then the project's folders to search. */
export function FolderChoice({
  count,
  current,
  picks,
  folders,
  onPick,
}: {
  /** How many attachments one pick sends: two or more read „Alle {n} in diesen Ordner“. */
  count: number
  /** The folder every one of them already goes to, if they share one. */
  current: FolderTarget | null
  picks: readonly QuickPick[]
  folders: readonly FolderOption[]
  onPick: (target: FolderTarget) => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
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
    const base = pick.why === 'suggestion' ? t('suggestion.label') : t(`filing.attachments.quick.${pick.why}`, { name: pick.of ?? '' })
    return pick.target.kind === 'new' ? `${base}${CLAUSE_JOIN}${t('suggestion.newFolder')}` : base
  }
  return (
    <section className="flex flex-col gap-2" data-testid="filing-folder-choice" aria-label={count > 1 ? t('filing.attachments.pickAll', { count }) : t('filing.attachments.pickOne')}>
      <SectionLabel as="h3">{count > 1 ? t('filing.attachments.pickAll', { count }) : t('filing.attachments.pickOne')}</SectionLabel>
      {picks.length > 0 && (
        <ul className="-mx-2" aria-label={t('filing.attachments.quick.label')} data-testid="filing-quick-picks">
          {picks.map((pick) => (
            <PickerRow
              key={pick.target.path}
              label={place(pick.target)}
              hint={hint(pick)}
              icon={pick.why === 'suggestion' ? AgentIcon : pick.target.kind === 'new' ? FolderPlus : pick.why === 'revision' ? FileStack : Paperclip}
              here={here(pick.target)}
              disabled={here(pick.target)}
              onPick={() => onPick(pick.target)}
              testId={`filing-quick-pick-${pick.why}`}
            />
          ))}
        </ul>
      )}
      <FolderPickerList
        destinations={destinations}
        currentFolderId={current?.kind === 'existing' ? current.folderId : undefined}
        listClassName="max-h-[min(40dvh,18rem)]"
        onPick={(folderId) => {
          const folder = folderId ? folders.find((option) => option.id === folderId) : null
          onPick(folder ? targetForPath(folder.path, folders, folder.id) : targetForPath('', folders))
        }}
      />
    </section>
  )
}

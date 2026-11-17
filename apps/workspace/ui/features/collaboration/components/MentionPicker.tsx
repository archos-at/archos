'use client'

import type { JSX } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AtSign, Sparkles, UserPlus } from 'lucide-react'

import { PersonAvatar } from '@/components/ui/avatar-stack'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { MentionCandidate } from '@/lib/mentions/types'
import { cn } from '@/lib/utils'

export interface MentionPickerHandle {
  move: (delta: number) => void
  selectActive: () => boolean
}

export interface MentionPickerAria {
  listboxId: string | null
  activeOptionId: string | null
}

export interface MentionPickerProps {
  query: string
  candidates: readonly MentionCandidate[]
  canInvite: boolean
  loading?: boolean
  onSelect: (candidate: MentionCandidate) => void
  onAriaChange?: (aria: MentionPickerAria) => void
  othersHeading?: string
  noResultsHint?: string
  notice?: string
  className?: string
}

export interface MentionCandidateGroups {
  agent: MentionCandidate[]
  participants: MentionCandidate[]
  others: MentionCandidate[]
  visible: MentionCandidate[]
  selectable: MentionCandidate[]
  preselected: number
}

const optionValue = (candidate: MentionCandidate): string => `mention:${candidate.targetId}`

export const mentionOptionDomId = (candidate: MentionCandidate): string =>
  `mention-option-${candidate.targetId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`

const isBlocked = (candidate: MentionCandidate, canInvite: boolean): boolean =>
  candidate.needsInvite && !canInvite

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}

const RANK = { nameStart: 0, inName: 1, emailOnly: 2 } as const
type Rank = (typeof RANK)[keyof typeof RANK]

function isWordStart(folded: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(folded[index - 1] ?? '')
}

function nameMatchIndex(folded: string, needle: string): number {
  let first = -1
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
    if (isWordStart(folded, at)) return at
    if (first < 0) first = at
  }
  return first
}

function rankOf(candidate: MentionCandidate, query: string, agentLabel: string): Rank | null {
  if (!query) return RANK.nameStart
  const needle = fold(query)
  const names = candidate.isAgent ? [candidate.person.name, agentLabel] : [candidate.person.name]
  let best: Rank | null = null
  for (const name of names) {
    const folded = fold(name)
    const at = nameMatchIndex(folded, needle)
    if (at < 0) continue
    const rank = isWordStart(folded, at) ? RANK.nameStart : RANK.inName
    if (best === null || rank < best) best = rank
  }
  if (best !== null) return best
  return fold(candidate.person.email ?? '').includes(needle) ? RANK.emailOnly : null
}

export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  canInvite: boolean,
  agentLabel: string,
): MentionCandidateGroups {
  const ranked = candidates.flatMap((candidate) => {
    const rank = rankOf(candidate, query, agentLabel)
    return rank === null ? [] : [{ candidate, rank }]
  })
  ranked.sort((a, b) => a.rank - b.rank)
  const rankOfHit = new Map(ranked.map(({ candidate, rank }) => [candidate, rank]))
  const hits = ranked.map(({ candidate }) => candidate)
  const agent = hits.filter((candidate) => candidate.isAgent)
  const participants = hits.filter((candidate) => !candidate.isAgent && candidate.isParticipant)
  const others = hits.filter((candidate) => !candidate.isAgent && !candidate.isParticipant)
  const visible = [...agent, ...participants, ...others]
  const selectable = visible.filter((candidate) => !isBlocked(candidate, canInvite))
  const best = ranked.find(({ candidate }) => !isBlocked(candidate, canInvite))?.rank
  const preselected = Math.max(
    0,
    selectable.findIndex((candidate) => rankOfHit.get(candidate) === best),
  )
  return { agent, participants, others, visible, selectable, preselected }
}

function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  const { folded, offsets } = foldWithOffsets(name)
  const needle = fold(query)
  const at = needle ? nameMatchIndex(folded, needle) : -1
  if (at < 0) return <>{name}</>
  const from = offsets[at]
  const to = offsets[at + needle.length]
  return (
    <>
      {name.slice(0, from)}
      <mark className="bg-transparent font-medium text-foreground">{name.slice(from, to)}</mark>
      {name.slice(to)}
    </>
  )
}

function foldWithOffsets(value: string): { folded: string; offsets: number[] } {
  let folded = ''
  const offsets: number[] = []
  let offset = 0
  for (const character of value) {
    const piece = fold(character)
    for (let index = 0; index < piece.length; index += 1) offsets.push(offset)
    folded += piece
    offset += character.length
  }
  offsets.push(offset)
  return { folded, offsets }
}

function CandidateAvatar({
  candidate,
  agentLabel,
}: {
  candidate: MentionCandidate
  agentLabel: string
}): JSX.Element {
  if (candidate.isAgent) {
    return (
      <span
        aria-hidden
        className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
        title={agentLabel}
      >
        <Sparkles className="size-4" />
      </span>
    )
  }

  return <PersonAvatar person={candidate.person} size="md" />
}

export const MentionPicker = forwardRef<MentionPickerHandle, MentionPickerProps>(
  function MentionPicker(
    {
      query,
      candidates,
      canInvite,
      loading = false,
      onSelect,
      onAriaChange,
      othersHeading,
      noResultsHint,
      notice,
      className,
    },
    ref,
  ) {
    const t = useTranslations(collaborationCopy)
    const agentLabel = t('mentions.picker.agentName')
    const resultsAria = t('mentions.picker.resultsAria')

    const groups = useMemo(
      () => filterMentionCandidates(candidates, query, canInvite, agentLabel),
      [candidates, query, canInvite, agentLabel],
    )
    const { selectable } = groups

    const rootRef = useRef<HTMLDivElement>(null)

    const selectionKey = `${query}\u0000${selectable.map((candidate) => candidate.targetId).join('|')}`
    const { preselected } = groups
    const [selection, setSelection] = useState({ key: selectionKey, index: preselected })
    const activeIndex = selection.key === selectionKey ? selection.index : preselected
    const select = useCallback(
      (index: number) => setSelection({ key: selectionKey, index }),
      [selectionKey],
    )
    const move = useCallback(
      (delta: number) => {
        const count = selectable.length
        if (count === 0) return
        setSelection((current) => {
          const from = current.key === selectionKey ? current.index : preselected
          return { key: selectionKey, index: (((from + delta) % count) + count) % count }
        })
      },
      [preselected, selectable.length, selectionKey],
    )

    const active = selectable[Math.min(activeIndex, Math.max(selectable.length - 1, 0))]

    useImperativeHandle(
      ref,
      () => ({
        move,
        selectActive: () => {
          if (!active) return false
          onSelect(active)
          return true
        },
      }),
      [active, move, onSelect],
    )

    const handleValueChange = useCallback(
      (value: string) => {
        const index = selectable.findIndex((candidate) => optionValue(candidate) === value)
        if (index >= 0) select(index)
      },
      [select, selectable],
    )

    useLayoutEffect(() => {
      if (!active) return
      rootRef.current
        ?.querySelector(`#${CSS.escape(mentionOptionDomId(active))}`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [active])

    const reportedRef = useRef<MentionPickerAria>({ listboxId: null, activeOptionId: null })
    useEffect(() => {
      if (!onAriaChange) return
      const next: MentionPickerAria = {
        listboxId: rootRef.current?.querySelector('[cmdk-list]')?.id ?? null,
        activeOptionId: active ? mentionOptionDomId(active) : null,
      }
      const previous = reportedRef.current
      if (previous.listboxId === next.listboxId && previous.activeOptionId === next.activeOptionId) {
        return
      }
      reportedRef.current = next
      onAriaChange(next)
    })

    const renderRow = (candidate: MentionCandidate): JSX.Element => {
      const blocked = isBlocked(candidate, canInvite)
      const name = candidate.isAgent ? agentLabel : candidate.person.name
      const secondary = candidate.isAgent
        ? t('mentions.picker.agentHint')
        : blocked
          ? t('mentions.picker.cannotInvite')
          : candidate.needsInvite
            ? t('mentions.picker.needsInviteHintShort')
            : (candidate.person.email ?? '')

      return (
        <CommandItem
          asChild
          key={candidate.targetId}
          value={optionValue(candidate)}
          disabled={blocked}
          onSelect={() => {
            if (!blocked) onSelect(candidate)
          }}
          className={cn(
            'items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-snap ease-out motion-reduce:transition-none',
            'data-[selected=true]:bg-hover data-[selected=true]:text-accent-foreground',
            blocked && 'opacity-55',
          )}
        >
          {/* `asChild` so the row carries OUR stable id (see mentionOptionDomId). */}
          <div
            id={mentionOptionDomId(candidate)}
            data-testid="mention-option"
            data-target-id={candidate.targetId}
          >
            <CandidateAvatar candidate={candidate} agentLabel={agentLabel} />

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm leading-tight text-foreground/85">
                <HighlightedName name={name} query={query} />
              </span>
              {secondary && (
                <span className="truncate text-xs leading-tight text-muted-foreground">
                  {secondary}
                </span>
              )}
            </span>

            {candidate.isAgent ? (
              <Badge variant="secondary" className="shrink-0 gap-1">
                {t('mentions.picker.badgeAgent')}
              </Badge>
            ) : candidate.needsInvite && !blocked ? (
              <Badge variant="warning" className="shrink-0 gap-1">
                <UserPlus aria-hidden />
                {t('mentions.picker.needsInvite')}
              </Badge>
            ) : null}
            {/* No badge for an ordinary participant. `badgeInChat` said "In diesem
                Chat" on every row of the group headed "IN DIESEM CHAT" — the
                participants group is the only place those rows are ever rendered,
                so the badge restated its own heading once per row and could never
                say anything else. Worse, it competed for attention with the two
                badges that DO carry information: "Assistent", and "Wird
                eingeladen", which warns that picking this row also invites someone.
                A badge now means the row is not ordinary. */}
          </div>
        </CommandItem>
      )
    }

    return (
      <div
        ref={rootRef}
        data-testid="mention-picker"
        className={cn(
          'bg-popover text-popover-foreground flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-full flex-col overflow-hidden rounded-xl shadow-lg',
          'animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out motion-reduce:animate-none',
          className,
        )}
      >
        {notice && (
          <p role="status" data-testid="mention-picker-notice" className="text-muted-foreground border-b px-3 py-2 text-xs">
            {notice}
          </p>
        )}
        <Command
          shouldFilter={false}
          loop
          label={resultsAria}
          value={active ? optionValue(active) : ''}
          onValueChange={handleValueChange}
          className="min-h-0 flex-1 bg-transparent"
        >
          {/* `scroll-fade-bottom`: with more candidates than fit, the panel used to
              cut the next row through its own text, which reads as a rendering bug
              rather than as an invitation to scroll. The footer below stays sharp —
              it is outside this scroll region. */}
          <CommandList
            label={resultsAria}
            className="scroll-fade-bottom max-h-none min-h-0 flex-1 p-1.5"
          >
            {loading ? (
              <div className="flex flex-col gap-1" aria-busy="true">
                <span className="sr-only">{t('mentions.picker.loading')}</span>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3 px-2.5 py-2">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-2.5 w-44" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty className="px-4 py-8 text-center">
                  <AtSign className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
                  <p className="mt-2.5 text-sm font-medium text-foreground">
                    {query
                      ? t('mentions.picker.noResults', { query })
                      : t('mentions.picker.empty')}
                  </p>
                  {query && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="mention-no-results-hint">
                      {noResultsHint ?? t('mentions.picker.placeholder')}
                    </p>
                  )}
                </CommandEmpty>

                {groups.agent.length > 0 && (
                  <CommandGroup
                    className="p-0 [&:not(:last-child)]:mb-1 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
                    aria-label={t('mentions.picker.badgeAgent')}
                  >
                    {groups.agent.map(renderRow)}
                  </CommandGroup>
                )}

                {groups.participants.length > 0 && (
                  <CommandGroup
                    heading={t('mentions.picker.participantsHeading')}
                    className="p-0 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {groups.participants.map(renderRow)}
                  </CommandGroup>
                )}

                {groups.others.length > 0 && (
                  <CommandGroup
                    heading={othersHeading ?? t('mentions.picker.othersHeading')}
                    className="p-0 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {groups.others.map(renderRow)}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>

        {/* Footer: outside the scroll container on purpose — the hint has to stay
            visible while the list scrolls. Not on a touch screen: those are
            hardware keys, and the row it costs is a row of names. */}
        <div
          className="bg-muted pointer-coarse:hidden flex shrink-0 items-center gap-2 border-t px-3 py-2"
          aria-label={t('mentions.picker.keyboardHint')}
        >
          <AtSign className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <KbdGroup>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </KbdGroup>
          <Kbd>↵</Kbd>
          <Kbd>Esc</Kbd>
        </div>
      </div>
    )
  },
)

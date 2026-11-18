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
import { Slash } from 'lucide-react'

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
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import { filterSlashCommands } from '../lib/slash-command'

export interface SlashCommandSkill {
  name: string
  description: string
  origin: 'org' | 'platform-clone' | 'platform'
}

export interface SlashCommandPickerHandle {
  move: (delta: number) => void
  selectActive: () => boolean
}

export interface SlashCommandPickerAria {
  listboxId: string | null
  activeOptionId: string | null
}

export interface SlashCommandPickerProps {
  query: string
  skills: readonly SlashCommandSkill[]
  loading?: boolean
  onSelect: (skill: SlashCommandSkill) => void
  onAriaChange?: (aria: SlashCommandPickerAria) => void
  className?: string
}

const optionValue = (skill: SlashCommandSkill): string => `skill:${skill.name}`

export const slashOptionDomId = (skill: SlashCommandSkill): string =>
  `slash-option-${skill.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}`

function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  const needle = query.trim().toLowerCase()
  const at = needle ? name.toLowerCase().indexOf(needle) : -1
  if (at < 0) return <>{name}</>
  return (
    <>
      {name.slice(0, at)}
      <mark className="bg-transparent font-medium text-foreground">
        {name.slice(at, at + needle.length)}
      </mark>
      {name.slice(at + needle.length)}
    </>
  )
}

export const SlashCommandPicker = forwardRef<SlashCommandPickerHandle, SlashCommandPickerProps>(
  function SlashCommandPicker(
    { query, skills, loading = false, onSelect, onAriaChange, className },
    ref,
  ) {
    const t = useTranslations(skillsCopy)
    const resultsAria = t('composer.picker.resultsAria')

    const visible = useMemo(() => filterSlashCommands(skills, query), [skills, query])

    const [activeIndex, setActiveIndex] = useState(0)
    const rootRef = useRef<HTMLDivElement>(null)

    const visibleKey = visible.map((skill) => skill.name).join('|')
    useEffect(() => {
      setActiveIndex(0)
    }, [visibleKey])

    const active = visible[Math.min(activeIndex, Math.max(visible.length - 1, 0))]

    useImperativeHandle(
      ref,
      () => ({
        move: (delta: number) => {
          if (visible.length === 0) return
          setActiveIndex((current) => {
            const next = (current + delta) % visible.length
            return next < 0 ? next + visible.length : next
          })
        },
        selectActive: () => {
          if (!active) return false
          onSelect(active)
          return true
        },
      }),
      [active, onSelect, visible.length],
    )

    const handleValueChange = useCallback(
      (value: string) => {
        const index = visible.findIndex((skill) => optionValue(skill) === value)
        if (index >= 0) setActiveIndex(index)
      },
      [visible],
    )

    useLayoutEffect(() => {
      if (!active) return
      rootRef.current
        ?.querySelector(`#${CSS.escape(slashOptionDomId(active))}`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [active])

    const reportedRef = useRef<SlashCommandPickerAria>({ listboxId: null, activeOptionId: null })
    useEffect(() => {
      if (!onAriaChange) return
      const next: SlashCommandPickerAria = {
        listboxId: rootRef.current?.querySelector('[cmdk-list]')?.id ?? null,
        activeOptionId: active ? slashOptionDomId(active) : null,
      }
      const previous = reportedRef.current
      if (previous.listboxId === next.listboxId && previous.activeOptionId === next.activeOptionId) {
        return
      }
      reportedRef.current = next
      onAriaChange(next)
    })

    const renderRow = (skill: SlashCommandSkill): JSX.Element => (
      <CommandItem
        asChild
        key={skill.name}
        value={optionValue(skill)}
        onSelect={() => onSelect(skill)}
        className={cn(
          'flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 transition-colors duration-snap ease-out',
          'data-[selected=true]:bg-hover data-[selected=true]:text-accent-foreground',
        )}
      >
        {/* `asChild` so the row carries OUR stable id (see slashOptionDomId). */}
        <div id={slashOptionDomId(skill)} data-testid="slash-option" data-skill-name={skill.name}>
          {/* Monospace: this is a literal token the user types, not a title. */}
          <span className="block truncate font-mono text-sm leading-tight text-foreground/90">
            /<HighlightedName name={skill.name} query={query} />
          </span>
          {/* Two lines, not one and not three. One would cut a spec-conformant
              description in half — losing exactly the "when to use it" clause
              that decides whether this is the row you want. Three made rows so
              tall the panel could not show a whole one at its bottom edge, and a
              menu you scan is worse for a ragged edge than for a clamp. The full
              text is one selection away, on the chip. */}
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground pointer-coarse:text-sm">
            {skill.description}
          </span>
        </div>
      </CommandItem>
    )

    return (
      <div
        ref={rootRef}
        data-testid="slash-command-picker"
        className={cn(
        'bg-popover text-popover-foreground flex max-h-[360px] w-full flex-col overflow-hidden rounded-xl shadow-lg',
          'animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out motion-reduce:animate-none',
          className,
        )}
      >
        <Command
          shouldFilter={false}
          loop
          label={resultsAria}
          value={active ? optionValue(active) : ''}
          onValueChange={handleValueChange}
          className="min-h-0 flex-1 bg-transparent"
        >
          <CommandList
            label={resultsAria}
            className="scroll-fade-bottom max-h-none min-h-0 flex-1 p-1.5"
          >
            {loading ? (
              <div className="flex flex-col gap-1" aria-busy="true">
                <span className="sr-only">{t('composer.picker.loading')}</span>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex flex-col gap-1.5 px-2.5 py-1.5">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2.5 w-52" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty className="px-4 py-8 text-center">
                  <Slash className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
                  <p className="mt-2.5 text-sm font-medium text-foreground">
                    {query
                      ? t('composer.picker.noResults', { query })
                      : t('composer.picker.empty')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {query ? t('composer.picker.noResultsHint') : t('composer.picker.emptyHint')}
                  </p>
                </CommandEmpty>

                {visible.length > 0 && (
                  <CommandGroup className="p-0" aria-label={resultsAria}>
                    {visible.map(renderRow)}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>

        {/* Outside the scroll region, so the hint stays put while the list moves. */}
        <div
          className="flex shrink-0 items-center gap-2 border-t bg-muted px-3 py-2 pointer-coarse:hidden"
          aria-label={t('composer.picker.keyboardHint')}
        >
          <Slash className="size-3 shrink-0 text-muted-foreground" aria-hidden />
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

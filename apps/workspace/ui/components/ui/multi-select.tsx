'use client'

import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { CountPill } from '@/components/ui/count-pill'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'

export interface MultiSelectOption {
  value: string
  label: string
  count?: number
  hint?: string
}

export interface MultiSelectProps {
  options: readonly MultiSelectOption[]
  value: readonly string[]
  onValueChange: (next: string[]) => void
  placeholder: string
  label: string
  searchPlaceholder?: string
  emptyText?: string
  removeLabel?: (label: string) => string
  moreLabel?: (count: number) => string
  labelFor?: (value: string) => string
  maxChips?: number
  searchable?: boolean
  disabled?: boolean
  loading?: boolean
  formatCount?: (count: number) => string
  id?: string
  className?: string
  'data-testid'?: string
}

const SEARCH_THRESHOLD = 8

function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder,
  label,
  searchPlaceholder,
  emptyText,
  removeLabel = (name) => `Remove ${name}`,
  moreLabel = (count) => `+${count}`,
  labelFor,
  maxChips = 3,
  searchable,
  disabled = false,
  loading = false,
  formatCount = String,
  id,
  className,
  'data-testid': testId,
}: MultiSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const listId = React.useId()

  const selected = React.useMemo(() => new Set(value), [value])
  const byValue = React.useMemo(() => new Map(options.map((option) => [option.value, option])), [options])
  const nameOf = (entry: string): string => byValue.get(entry)?.label ?? labelFor?.(entry) ?? entry

  const ordered = (next: ReadonlySet<string>): string[] => [
    ...options.filter((option) => next.has(option.value)).map((option) => option.value),
    ...[...next].filter((entry) => !byValue.has(entry)),
  ]

  const toggle = (entry: string): void => {
    const next = new Set(selected)
    if (next.has(entry)) next.delete(entry)
    else next.add(entry)
    onValueChange(ordered(next))
  }
  const remove = (entry: string): void => onValueChange(value.filter((current) => current !== entry))

  const shown = value.slice(0, maxChips)
  const hidden = value.length - shown.length
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverAnchor asChild>
        <div
          role="group"
          aria-label={label}
          data-slot="multi-select"
          data-testid={testId}
          data-disabled={disabled || undefined}
          className={cn(
            'border-input bg-input-background flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1 rounded-control border py-1 pr-1 pl-1.5 text-sm pointer-coarse:min-h-11',
            'transition-opacity duration-quick ease-out motion-reduce:transition-none',
            'has-[[data-slot=multi-select-trigger]:focus-visible]:border-ring [&_[data-slot=multi-select-trigger]:focus-visible]:outline-hidden!',
            disabled && 'cursor-not-allowed opacity-50',
            className
          )}
        >
          {shown.map((entry) => {
            const name = nameOf(entry)
            return (
              <Chip key={entry} variant="secondary" className="max-w-full gap-0.5 pr-0.5" data-slot="multi-select-chip">
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(entry)}
                  aria-label={removeLabel(name)}
                  className={cn(
                    'text-muted-foreground hover:bg-hover hover:text-foreground touch-target inline-flex size-4 shrink-0 items-center justify-center rounded-control outline-none',
                    FOCUS_RING
                  )}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Chip>
            )
          })}
          {hidden > 0 ? (
            <Chip asChild variant="muted" interactive>
              <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
                {moreLabel(hidden)}
              </button>
            </Chip>
          ) : null}
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              disabled={disabled}
              data-slot="multi-select-trigger"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-haspopup="listbox"
              aria-label={label}
              className={cn(
                'text-muted-foreground flex min-h-7 flex-1 items-center justify-between gap-2 rounded-control px-1.5 text-left outline-none disabled:cursor-not-allowed',
                value.length === 0 ? 'min-w-16' : 'min-w-6 justify-end',
                'pointer-coarse:min-h-9'
              )}
            >
              <span className="truncate">{value.length === 0 ? placeholder : ''}</span>
              <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)] p-0"
        collisionPadding={16}
      >
        <Command
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && search === '' && value.length > 0) {
              event.preventDefault()
              remove(value[value.length - 1])
            }
          }}
        >
          {withSearch ? (
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder ?? label}
            />
          ) : null}
          <CommandList id={listId} aria-label={label} aria-multiselectable="true">
            {loading ? (
              <div className="flex justify-center py-6" role="status">
                <Spinner size="sm" className="text-muted-foreground" aria-hidden />
              </div>
            ) : (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => {
                const checked = selected.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, option.hint ?? '']}
                    onSelect={() => toggle(option.value)}
                    aria-checked={checked}
                    data-checked={checked || undefined}
                    className="pointer-coarse:min-h-11"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'border-input flex size-4 shrink-0 items-center justify-center rounded-control border',
                        checked && 'border-primary bg-primary text-primary-foreground'
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="text-muted-foreground truncate text-xs">{option.hint}</span>
                      ) : null}
                    </span>
                    {option.count !== undefined ? <CountPill>{formatCount(option.count)}</CountPill> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { MultiSelect }

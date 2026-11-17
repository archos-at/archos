'use client'

import type { JSX } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref } from 'react'
import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CONTROL_HEIGHT, type ControlSize } from '@/components/ui/control-height'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  clearLabel?: string
  onClear?: () => void
  className?: string
  inputClassName?: string
  clearClassName?: string
  size?: ControlSize
  type?: 'search' | 'text'
  inputRef?: Ref<HTMLInputElement>
  trailing?: ReactNode
  hint?: ReactNode
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onFocusChange?: (focused: boolean) => void
  combobox?: SearchFieldCombobox
}

export interface SearchFieldCombobox {
  controls: string
  expanded: boolean
  activeDescendant?: string | null
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  onClear,
  className,
  inputClassName,
  clearClassName,
  size = 'default',
  type = 'text',
  inputRef,
  trailing,
  hint,
  onKeyDown,
  onFocusChange,
  combobox,
}: SearchFieldProps): JSX.Element {
  const canClear = Boolean(clearLabel)
  const hasValue = Boolean(value)

  const field = (
    <InputGroup>
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <Input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
        placeholder={placeholder}
        aria-label={label}
        {...(combobox
          ? {
              role: 'combobox',
              'aria-autocomplete': 'list' as const,
              'aria-controls': combobox.controls || undefined,
              'aria-expanded': combobox.expanded,
              'aria-activedescendant': combobox.activeDescendant ?? undefined,
            }
          : {})}
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          CONTROL_HEIGHT[size],
          'pl-8 [&::-webkit-search-cancel-button]:hidden',
          canClear && 'pr-8 pointer-coarse:pr-11',
          hint && !hasValue && 'sm:pr-20',
          inputClassName,
        )}
      />
      {hint && !hasValue ? (
        <InputGroupAddon align="end" className="right-2 max-sm:hidden pointer-coarse:hidden" aria-hidden>
          {hint}
        </InputGroupAddon>
      ) : null}
      {canClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tabIndex={hasValue ? undefined : -1}
          aria-hidden={!hasValue}
          className={cn(
            'absolute right-0.5 top-1/2 size-8 -translate-y-1/2 text-muted-foreground',
            hasValue ? 'opacity-100' : 'pointer-events-none opacity-0',
            clearClassName,
          )}
          aria-label={clearLabel}
          onClick={() => {
            if (!hasValue) return
            if (onClear) {
              onClear()
            } else {
              onChange('')
            }
          }}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </InputGroup>
  )

  if (!trailing) {
    return className ? <div className={className}>{field}</div> : field
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {field}
      <div className="shrink-0">{trailing}</div>
    </div>
  )
}

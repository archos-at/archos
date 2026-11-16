'use client'

import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { FIELD_FOCUS_WITHIN_RING, FOCUS_RING } from '@/components/ui/focus-ring'

export function defaultTagNormalize(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    const key = value.toLocaleLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

const SEPARATORS = /[,;\n\r]+/

export interface TagInputProps {
  value: readonly string[]
  onChange: (next: string[]) => void
  removeLabel: (tag: string) => string
  normalize?: (values: string[]) => string[]
  readOnly?: boolean
  emptyLabel?: string
  id?: string
  placeholder?: string
  'aria-label'?: string
  'aria-describedby'?: string
  className?: string
}

export function TagInput({
  value,
  onChange,
  removeLabel,
  normalize = defaultTagNormalize,
  readOnly = false,
  emptyLabel,
  id,
  placeholder,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className,
}: TagInputProps): React.JSX.Element {
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const add = (text: string): void => {
    const parts = text.split(SEPARATORS).filter((part) => part.trim() !== '')
    setDraft('')
    if (parts.length === 0) return
    onChange(normalize([...value, ...parts]))
  }

  const remove = (index: number): void => {
    onChange(value.filter((_, at) => at !== index))
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add(draft)
      return
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault()
      remove(value.length - 1)
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData.getData('text')
    if (!SEPARATORS.test(text)) return
    event.preventDefault()
    add(`${draft}${text}`)
  }

  return (
    <div
      data-slot="tag-input"
      data-readonly={readOnly || undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus()
      }}
      className={cn(
        'flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-control border px-2 py-1.5 text-sm',
        'transition-[color,opacity] duration-quick ease-out motion-reduce:transition-none',
        readOnly ? 'border-dashed bg-transparent' : 'border-input bg-input-background',
        !readOnly && FIELD_FOCUS_WITHIN_RING,
        className
      )}
    >
      {value.length > 0 && (
        <ul className="contents" aria-label={ariaLabel}>
          {value.map((tag, index) => (
            <li key={tag} className="max-w-full">
              <Chip variant="secondary" className={cn('max-w-full', !readOnly && 'pr-1')}>
                <span className="truncate">{tag}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={removeLabel(tag)}
                    className={cn(
                      'touch-target inline-flex size-4 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-foreground',
                      FOCUS_RING
                    )}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {readOnly && value.length === 0 && emptyLabel && (
        <span className="px-1 text-muted-foreground">{emptyLabel}</span>
      )}
      {!readOnly && (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => add(draft)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          enterKeyHint="done"
          autoComplete="off"
          className="h-7 min-w-32 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground pointer-coarse:h-11 pointer-coarse:text-base"
        />
      )}
    </div>
  )
}

'use client'

import type { JSX } from 'react'
import { useId, useRef, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, motionEntrance, motionQuick } from '@/components/motion'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSlashCommand } from '../hooks/use-slash-command'
import { InvokedSkillChip } from './InvokedSkillChip'
import { SlashCommandPicker } from './SlashCommandPicker'

export interface SkillPromptFieldProps {
  value: string
  onChange: (value: string) => void
  enabled?: boolean
  rows?: number
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  onBlur?: () => void
  className?: string
  'data-testid'?: string
}

export function SkillPromptField({
  value,
  onChange,
  enabled = true,
  rows = 8,
  placeholder,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  onBlur,
  className,
  'data-testid': testId,
}: SkillPromptFieldProps): JSX.Element {
  const fallbackId = useId()
  const fieldId = id ?? fallbackId
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const slash = useSlashCommand({
    text: value,
    enabled,
    onReplaceText: (nextText, caret) => {
      onChange(nextText)
      requestAnimationFrame(() => {
        const node = textareaRef.current
        if (!node) return
        node.focus()
        node.setSelectionRange(caret, caret)
      })
    },
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    slash.handleKeyDown(event, () => {})
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid={testId}>
      <Popover open={slash.open} onOpenChange={(next) => !next && slash.dismiss()}>
        <PopoverAnchor asChild>
          <div ref={anchorRef}>
            <Textarea
              ref={textareaRef}
              id={fieldId}
              rows={rows}
              value={value}
              placeholder={placeholder}
              aria-label={ariaLabel}
              aria-describedby={describedBy}
              onBlur={onBlur}
              onChange={(event) => {
                onChange(event.target.value)
                slash.syncQuery(event.target.value, event.target.selectionStart ?? 0)
              }}
              onKeyUp={(event) => {
                const node = event.currentTarget
                slash.syncQuery(node.value, node.selectionStart ?? 0)
              }}
              onClick={(event) => {
                const node = event.currentTarget
                slash.syncQuery(node.value, node.selectionStart ?? 0)
              }}
              onKeyDown={handleKeyDown}
              role={slash.open ? 'combobox' : undefined}
              aria-expanded={slash.open ? true : undefined}
              aria-haspopup={slash.open ? 'listbox' : undefined}
              aria-autocomplete={slash.open ? 'list' : undefined}
              aria-controls={slash.open ? (slash.aria.listboxId ?? undefined) : undefined}
              aria-activedescendant={
                slash.open ? (slash.aria.activeOptionId ?? undefined) : undefined
              }
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="w-[var(--radix-popover-trigger-width)] border-0 bg-transparent p-0 shadow-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as Node | null
            if (target && anchorRef.current?.contains(target)) event.preventDefault()
          }}
        >
          <SlashCommandPicker
            ref={slash.pickerRef}
            query={slash.query}
            skills={slash.skills}
            loading={slash.loading}
            onSelect={slash.select}
            onAriaChange={slash.onAriaChange}
          />
        </PopoverContent>
      </Popover>

      {/* The chip is DERIVED from the text, so removing it edits the name back
          out and the two can never disagree about what this task names. */}
      <AnimatePresence initial={false}>
        {slash.invokedSkill && (
          <motion.div
            key={`invoked-skill-${slash.invokedSkill.name}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: motionEntrance }}
            exit={{ opacity: 0, y: 2, transition: motionQuick }}
          >
            <InvokedSkillChip
              name={slash.invokedSkill.name}
              description={slash.invokedSkill.description}
              onRemove={slash.clearInvocation}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

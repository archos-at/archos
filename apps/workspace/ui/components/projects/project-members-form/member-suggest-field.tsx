'use client'

import type { JSX } from 'react'
import { useId, useState } from 'react'
import { FieldShell, useFieldContext } from '@/components/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useTranslations } from '@/i18n'
import { membersCopy } from '@/i18n/namespaces/members'
import { cn } from '@/lib/utils'
import { MemberAvatar } from './member-avatar'
import type { Member, ProjectRole } from './member-types'

const MAX_SUGGESTIONS = 6

interface MemberSuggestFieldProps {
  label: string
  placeholder: string
  members: Member[]
  roleLabel: (role: ProjectRole) => string
  containerClassName?: string
}

export function MemberSuggestField({
  label,
  placeholder,
  members,
  roleLabel,
  containerClassName,
}: MemberSuggestFieldProps): JSX.Element {
  const t = useTranslations(membersCopy)
  const field = useFieldContext<string>()
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const query = (field.state.value ?? '').trim().toLowerCase()
  const suggestions = members
    .filter((member) => member.email)
    .filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(Boolean(a.role)) - Number(Boolean(b.role)) || a.name.localeCompare(b.name)
    )
    .slice(0, MAX_SUGGESTIONS)

  const active = Math.min(highlight, Math.max(suggestions.length - 1, 0))
  const optionId = (index: number): string => `${listboxId}-option-${index}`

  const errors = field.state.meta.isTouched
    ? (field.state.meta.errors as Array<string | { message: string } | undefined>)
    : []

  const pick = (member: Member): void => {
    field.handleChange(member.email ?? '')
    setOpen(false)
  }

  return (
    <FieldShell label={label} htmlFor={field.name} errors={errors} className={containerClassName}>
      {/* The suggestion list is the shared floating `PopoverContent` anchored
          to the field, not a hand-rolled absolute panel: same floating
          chrome, same outside-click/Escape contract. Keyboard behaviour is
          ported unchanged (ArrowUp/Down move, Enter picks, Escape closes) and
          rows grow to the touch floor on a coarse pointer. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            id={field.name}
            name={field.name}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && suggestions[active] ? optionId(active) : undefined}
            aria-invalid={errors.length > 0 || undefined}
            placeholder={placeholder}
            value={field.state.value ?? ''}
            onChange={(event) => {
              field.handleChange(event.target.value)
              setOpen(true)
              setHighlight(0)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              field.handleBlur()
              setOpen(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpen(true)
                setHighlight((value) => Math.min(value + 1, suggestions.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((value) => Math.max(value - 1, 0))
              } else if (event.key === 'Enter') {
                if (open && suggestions[active]) {
                  event.preventDefault()
                  pick(suggestions[active])
                }
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label={t('invite.suggestionsAria')}
          >
            {suggestions.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2.5 text-sm">
                {t('invite.noSuggestions')}
              </p>
            ) : (
              suggestions.map((member, index) => (
                <div
                  key={member.organizationMembershipId}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(member)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    'duration-snap flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors ease-out pointer-coarse:min-h-11 motion-reduce:transition-none',
                    index === active && 'bg-accent'
                  )}
                >
                  <MemberAvatar member={member} className="size-7" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{member.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{member.email}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {member.role ? roleLabel(member.role) : t('roster.noAccess')}
                  </span>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </FieldShell>
  )
}

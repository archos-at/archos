'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export type ActionMenuItemEntry = {
  type: 'item'
  id: string
  label: string
  icon?: LucideIcon
  variant?: 'default' | 'destructive'
  disabled?: boolean
  hint?: string
  onSelect?: () => void
  href?: string
  download?: boolean
  testId?: string
}

export type ActionMenuSeparatorEntry = { type: 'separator' }

export type ActionMenuLabelEntry = { type: 'label'; label: string }

export type ActionMenuSubEntry = {
  type: 'sub'
  id: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
  testId?: string
  items: ActionMenuEntry[]
}

export type ActionMenuRadioEntry = {
  type: 'radio-group'
  value: string
  onValueChange: (value: string) => void
  items: { value: string; label: string; testId?: string }[]
}

export type ActionMenuEntry =
  | ActionMenuItemEntry
  | ActionMenuSeparatorEntry
  | ActionMenuLabelEntry
  | ActionMenuSubEntry
  | ActionMenuRadioEntry

type MenuParts = {
  Item: typeof DropdownMenuItem
  Label: typeof DropdownMenuLabel
  Separator: typeof DropdownMenuSeparator
  Sub: typeof DropdownMenuSub
  SubTrigger: typeof DropdownMenuSubTrigger
  SubContent: typeof DropdownMenuSubContent
  RadioGroup: typeof DropdownMenuRadioGroup
  RadioItem: typeof DropdownMenuRadioItem
  subContentClassName: string
}

const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  subContentClassName: 'w-64 max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))]',
}

const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
  subContentClassName: 'w-64 max-h-[min(18rem,var(--radix-context-menu-content-available-height))]',
}

function renderEntries(entries: readonly ActionMenuEntry[], parts: MenuParts): ReactNode {
  return entries.map((entry, index) => {
    switch (entry.type) {
      case 'separator':
        return <parts.Separator key={`sep-${index}`} />
      case 'label':
        return (
          <parts.Label key={`label-${index}`} className="text-muted-foreground text-xs font-medium">
            {entry.label}
          </parts.Label>
        )
      case 'item': {
        const Icon = entry.icon
        const content = (
          <>
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {entry.hint ? (
              <span className="flex min-w-0 flex-col">
                <span>{entry.label}</span>
                <span className="text-muted-foreground text-xs leading-snug">{entry.hint}</span>
              </span>
            ) : (
              entry.label
            )}
          </>
        )
        if (entry.href) {
          return (
            <parts.Item key={entry.id} variant={entry.variant} disabled={entry.disabled} onSelect={entry.onSelect} asChild>
              <a
                href={entry.href}
                data-testid={entry.testId}
                {...(entry.download ? { download: true } : { target: '_blank', rel: 'noreferrer' })}
              >
                {content}
              </a>
            </parts.Item>
          )
        }
        return (
          <parts.Item
            key={entry.id}
            variant={entry.variant}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
            data-testid={entry.testId}
          >
            {content}
          </parts.Item>
        )
      }
      case 'sub': {
        const Icon = entry.icon
        return (
          <parts.Sub key={entry.id}>
            <parts.SubTrigger disabled={entry.disabled} data-testid={entry.testId}>
              {Icon ? <Icon className="size-4" aria-hidden /> : null}
              {entry.label}
            </parts.SubTrigger>
            <parts.SubContent className={parts.subContentClassName}>
              {renderEntries(entry.items, parts)}
            </parts.SubContent>
          </parts.Sub>
        )
      }
      case 'radio-group':
        return (
          <parts.RadioGroup
            key={`radio-${index}`}
            value={entry.value}
            onValueChange={entry.onValueChange}
          >
            {entry.items.map((item) => (
              <parts.RadioItem key={item.value} value={item.value} data-testid={item.testId}>
                {item.label}
              </parts.RadioItem>
            ))}
          </parts.RadioGroup>
        )
      default: {
        const _exhaustive: never = entry
        return _exhaustive
      }
    }
  })
}

export interface ActionMenuProps {
  entries: readonly ActionMenuEntry[]
  mode: 'dropdown' | 'context'
  trigger?: ReactNode
  children?: ReactNode
  contentClassName?: string
  align?: 'start' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  onOpenChange?: (open: boolean) => void
  open?: boolean
  asChild?: boolean
  keepHost?: boolean
}

export function ActionMenu({
  entries,
  mode,
  trigger,
  children,
  contentClassName = 'w-56',
  align = 'end',
  side = 'bottom',
  onOpenChange,
  open,
  asChild = false,
  keepHost = false,
}: ActionMenuProps): ReactNode {
  if (entries.length === 0 && !(mode === 'context' && keepHost)) {
    return mode === 'context' ? (children ?? null) : null
  }

  if (mode === 'dropdown') {
    if (!trigger) return null
    return (
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} side={side} className={contentClassName}>
          {renderEntries(entries, DROPDOWN_PARTS)}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        {asChild ? children : <div className="h-full min-w-0">{children}</div>}
      </ContextMenuTrigger>
      <ContextMenuContent className={contentClassName}>
        {renderEntries(entries, CONTEXT_PARTS)}
      </ContextMenuContent>
    </ContextMenu>
  )
}

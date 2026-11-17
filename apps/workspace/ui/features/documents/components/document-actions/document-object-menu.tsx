'use client'

import { createContext, useCallback, useContext, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ActionMenu } from '@/components/ui/action-menu'
import { useTranslations } from '@/i18n'
import { DOCUMENT_SCOPE_COPY } from './document-scope'
import {
  DEFAULT_DOCUMENT_ACTIONS,
  type DocumentActionKind,
} from './action-entries'
import {
  useDocumentActionMenu,
  type DocumentActionsMenuProps,
} from './document-actions-menu'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TriggerContext = createContext<ReactNode>(null)

export function DocumentActionsTrigger(): ReactNode {
  return useContext(TriggerContext)
}

export interface DocumentObjectMenuProps extends Omit<
  DocumentActionsMenuProps,
  'trigger' | 'align' | 'side' | 'actions'
> {
  actions?: readonly DocumentActionKind[]
  children: ReactNode
  asChild?: boolean
}

const OPENING_KEYS = new Set(['Enter', ' ', 'ArrowDown'])

export function DocumentObjectMenu({
  children,
  actions = DEFAULT_DOCUMENT_ACTIONS,
  asChild = false,
  ...props
}: DocumentObjectMenuProps): ReactNode {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[props.scope])
  const [live, setLive] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { entries, dialogs, name } = useDocumentActionMenu({ ...props, actions, live })

  const openDropdown = useCallback(() => {
    setLive(true)
    setDropdownOpen(true)
  }, [])
  const onContextOpenChange = useCallback((open: boolean) => {
    if (open) setLive(true)
  }, [])

  const buttonProps = {
    type: 'button' as const,
    variant: 'ghost' as const,
    size: 'icon' as const,
    className: 'size-8 shrink-0 rounded-full',
    'aria-label': t('actions.label', { name }),
    'aria-haspopup': 'menu' as const,
    title: t('actions.menuLabel'),
  }
  const icon = <MoreHorizontal className="size-4" aria-hidden />

  const trigger = live ? (
    <ActionMenu
      mode="dropdown"
      entries={entries}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      trigger={
        <Button {...buttonProps} data-testid="document-actions-trigger">
          {icon}
        </Button>
      }
    />
  ) : (
    <Button
      {...buttonProps}
      data-testid="document-actions-trigger"
      aria-expanded={false}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || event.ctrlKey) return
        event.preventDefault()
        openDropdown()
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!OPENING_KEYS.has(event.key)) return
        event.preventDefault()
        openDropdown()
      }}
    >
      {icon}
    </Button>
  )

  return (
    <TriggerContext.Provider value={trigger}>
      <ActionMenu mode="context" entries={entries} asChild={asChild} keepHost onOpenChange={onContextOpenChange}>
        {children}
      </ActionMenu>
      {dialogs}
    </TriggerContext.Provider>
  )
}

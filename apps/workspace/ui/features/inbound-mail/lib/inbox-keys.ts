'use client'

import { useEffect, type RefObject } from 'react'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
import { bulkSelectable } from './impersonation'
import { dismissErases, dismissKeyAllowed } from './inbox-triage'

export interface InboxKeyTarget {
  rows: readonly InboundMailSummaryView[]
  items: readonly InboundMailSummaryView[]
  focusedId: string | null
  mailId: string | null
  selectedIds: readonly string[]
  checked: ReadonlySet<string>
  focus: (mailId: string) => void
  open: (mailId: string) => void
  toggle: (mailId: string, checked: boolean) => void
  preview: () => void
  file: () => void
  dismissOpen: () => void
  askDismissSelection: () => void
  askErase: (mailId: string) => void
}

const PRESSABLE = 'button, a, [role="radio"], [role="checkbox"]'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const onPressable = (event: KeyboardEvent): boolean => event.target instanceof HTMLElement && event.target.closest(PRESSABLE) !== null

export function useInboxKeys(enabled: boolean, root: RefObject<HTMLElement | null>, target: RefObject<InboxKeyTarget | null>): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const inbox = target.current
      if (!inbox) return
      const { rows, mailId: open } = inbox
      const index = rows.findIndex((mail) => mail.id === (inbox.focusedId ?? open))
      const current = index >= 0 ? rows[index] : null
      const key = event.key
      if (key === 'j' || key === 'k') {
        event.preventDefault()
        if (rows.length === 0) return
        const next = index < 0 ? (key === 'j' ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))
        inbox.focus(rows[next].id)
        document.querySelector(`[data-mail-id="${CSS.escape(rows[next].id)}"]`)?.scrollIntoView({ block: 'nearest' })
        return
      }
      if (key === 'Enter') {
        if (onPressable(event) || !current) return
        event.preventDefault()
        inbox.open(current.id)
        return
      }
      if (key === 'x') {
        if (!current || !bulkSelectable(current)) return
        event.preventDefault()
        inbox.toggle(current.id, !inbox.checked.has(current.id))
        return
      }
      if (key === ' ' && open) {
        if (onPressable(event)) return
        event.preventDefault()
        inbox.preview()
        return
      }
      if (key === 'e' && open) {
        event.preventDefault()
        inbox.file()
        return
      }
      if (key !== 'Backspace' && key !== 'Delete') return
      if (event.target instanceof Element && !dismissKeyAllowed(event.target, root.current, open)) return
      event.preventDefault()
      if (inbox.selectedIds.length > 0) return inbox.askDismissSelection()
      if (!open) return
      const summary = inbox.items.find((mail) => mail.id === open)
      if (summary && dismissErases(summary)) inbox.askErase(open)
      else inbox.dismissOpen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, root, target])
}

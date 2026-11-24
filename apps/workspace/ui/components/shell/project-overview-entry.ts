'use client'

import type { MouseEvent } from 'react'
import { create } from 'zustand'

import { NEW_PROJECT_PATH, PROJECT_OVERVIEW_PATH } from './landing'
import type { PaletteSummon } from './shell-overlays'

interface ProjectOverviewState {
  open: boolean
  create: boolean
  summon: PaletteSummon
  returnFocus: HTMLElement | null
  show: (options: { create: boolean; summon: PaletteSummon; returnFocus: HTMLElement | null }) => void
  setOpen: (open: boolean) => void
}

export const useProjectOverview = create<ProjectOverviewState>()((set) => ({
  open: false,
  create: false,
  summon: 'pointer',
  returnFocus: null,
  show: (options) => set({ open: true, ...options }),
  setOpen: (open) => set({ open }),
}))

function triggerOfClosingLayer(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  const layer = active.closest<HTMLElement>('[role="dialog"][id]')
  const owner = layer ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(layer.id)}"]`) : null
  return owner ?? active
}

export function openProjectOverview({ create = false, summon = 'pointer' }: { create?: boolean; summon?: PaletteSummon } = {}): void {
  useProjectOverview.getState().show({ create, summon, returnFocus: triggerOfClosingLayer() })
}

export function isOverviewHref(href: string): boolean {
  return href.split('?')[0] === PROJECT_OVERVIEW_PATH
}

export function openOverviewFor(href: string, summon: PaletteSummon = 'pointer'): boolean {
  if (!isOverviewHref(href)) return false
  openProjectOverview({ create: href === NEW_PROJECT_PATH, summon })
  return true
}

const opensInPlace = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented

export function overviewLinkClick(href: string, event: MouseEvent): void {
  if (!isOverviewHref(href) || !opensInPlace(event)) return
  event.preventDefault()
  openOverviewFor(href, event.detail === 0 ? 'keyboard' : 'pointer')
}

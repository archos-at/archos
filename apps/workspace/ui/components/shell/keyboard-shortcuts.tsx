'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { useShortcutsPreference } from '@/hooks/use-shortcuts-preference'
import { CommandPalette, projectIdFromPathname } from './command-palette'
import { useShellOverlays } from './shell-overlays'
import { ShortcutsCheatsheet } from './shortcuts-cheatsheet'
import {
  isModifierKey,
  LEADER_KEY,
  LEADER_TIMEOUT_MS,
  resolveJump,
  type ShortcutFlags,
} from './shortcuts'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface KeyboardShortcutsProps {
  authRequired: boolean
  canViewOrganization: boolean
  showKnowledge?: boolean
  showModels?: boolean
  showSkills?: boolean
  canAccessOfficeShelf?: boolean
  canAccessOfficeStandards?: boolean
  canCollaborate?: boolean
  canAccessInbox?: boolean
  inboundMail?: boolean
}

export function KeyboardShortcuts({
  authRequired,
  canViewOrganization,
  showKnowledge = false,
  showModels = false,
  showSkills = false,
  canAccessOfficeShelf = false,
  canAccessOfficeStandards = false,
  canCollaborate = false,
  canAccessInbox = false,
  inboundMail = false,
}: KeyboardShortcutsProps) {
  const { enabled } = useShortcutsPreference()
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const paletteOpen = useShellOverlays((s) => s.paletteOpen)
  const setPaletteOpen = useShellOverlays((s) => s.setPaletteOpen)
  const togglePalette = useShellOverlays((s) => s.togglePalette)
  const [cheatsheetOpen, setCheatsheetOpen] = React.useState(false)
  const leaderArmedAtRef = React.useRef<number | null>(null)

  const flags: ShortcutFlags = React.useMemo(
    () => ({
      canViewOrganization,
      showKnowledge,
      showSkills,
      showModels,
      canAccessOfficeShelf,
      canAccessOfficeStandards,
      canCollaborate,
      canAccessInbox,
      inboundMail,
    }),
    [
      canViewOrganization,
      showKnowledge,
      showSkills,
      showModels,
      canAccessOfficeShelf,
      canAccessOfficeStandards,
      canCollaborate,
      canAccessInbox,
      inboundMail,
    ],
  )

  const projectIdRef = React.useRef<string | null>(null)
  projectIdRef.current = projectIdFromPathname(pathname)

  React.useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        leaderArmedAtRef.current = null
        setCheatsheetOpen(false)
        togglePalette()
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      if (event.key === '?') {
        event.preventDefault()
        leaderArmedAtRef.current = null
        setCheatsheetOpen(true)
        return
      }

      const armedAt = leaderArmedAtRef.current
      if (armedAt !== null && Date.now() - armedAt <= LEADER_TIMEOUT_MS) {
        if (isModifierKey(event.key)) return
        leaderArmedAtRef.current = null
        const href = resolveJump(event.key, flags, projectIdRef.current)
        if (href) {
          event.preventDefault()
          router.push(href)
        }
        return
      }

      if (event.key.toLowerCase() === LEADER_KEY && !event.shiftKey) {
        leaderArmedAtRef.current = Date.now()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, router, flags, togglePalette])

  return (
    <>
      {/* Mounted whether or not shortcuts are on: turning the keys off must
          not take the search button's palette with them. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        authRequired={authRequired}
        canViewOrganization={canViewOrganization}
        showKnowledge={showKnowledge}
        showModels={showModels}
        showSkills={showSkills}
        canAccessOfficeShelf={canAccessOfficeShelf}
        canAccessOfficeStandards={canAccessOfficeStandards}
      />
      {/* Only `?` opens the cheatsheet, so it only ever opens for someone at a
          keyboard; with shortcuts off it is not mounted at all. */}
      {enabled && (
      <ShortcutsCheatsheet
        open={cheatsheetOpen}
        onOpenChange={setCheatsheetOpen}
        canViewOrganization={canViewOrganization}
        showKnowledge={showKnowledge}
        showModels={showModels}
        showSkills={showSkills}
        canAccessOfficeShelf={canAccessOfficeShelf}
        canAccessOfficeStandards={canAccessOfficeStandards}
        canCollaborate={canCollaborate}
        canAccessInbox={canAccessInbox}
        inboundMail={inboundMail}
      />
      )}
    </>
  )
}

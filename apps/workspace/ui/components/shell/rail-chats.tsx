'use client'

/**
 * The project's last chats in the rail, as a list of their own under the sections (design-language.md, „The app
 * rail“).
 *
 * None of the pilot offices found the chat history (2026-11-10): its one door was an unlabelled glyph in the
 * chat's toolbar. The rail is where a person looks for a place, so the last chats stand there as places, the
 * open one as the current place (the sheet), and „Alle Chats“ opens the whole history. Since 2026-11-11 they are
 * headed „Letzte Chats“ and scroll between the sections and the office's doorways, as a chat app lists them; nested
 * under „Chat“, five of them pushed the other sections down the rail.
 *
 * The shell never imports a feature (module-seams.md), so the rows come in through {@link RailChatsSource}: the
 * chat's side (`RailChatsProvider` in `features/layout`) reads them from the chat store, the same rows its
 * history sheet lists, and the app layout puts it round the shell. Without a source the rail shows none.
 */

import type { JSX } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { motion, springGlide } from '@/components/motion'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'

/** How many chats the rail lists: the ten newest, then „Alle Chats“ opens the history sheet (owner decision
 *  2026-11-11: the rail is no endless scroll of every chat; the sheet, with its search and days, is where the rest
 *  is). The list still scrolls where ten rows do not fit between the sections and the office's doorways. */
export const RAIL_CHAT_LIMIT = 10

export interface RailChat {
  id: string
  /** The title as the history shows it (a placeholder for an untitled chat, the neutral one for a locked chat). */
  title: string
  href: string
  /** The chat open on the page: the rail's current place. */
  current: boolean
}

export interface RailChats {
  /** Newest first, at most {@link RAIL_CHAT_LIMIT}. Empty for a project with no chats: the rail then shows nothing. */
  items: RailChat[]
  /** The chat route, where the history sheet opens. */
  allHref: string
  /** Called before a row's link is followed: on the chat route the store switches threads, since the URL alone does not. */
  onOpen?: (id: string) => void
  /** Called before „Alle Chats“ is followed: opens the history sheet. */
  onOpenAll?: () => void
}

const RailChatsContext = createContext<RailChats | null>(null)

/** Hands the rail its chats. Provided by the chat's side; see the module note. */
export const RailChatsSource = RailChatsContext.Provider

export function useRailChats(): RailChats | null {
  return useContext(RailChatsContext)
}

// The rows' text stands on the sections' glyphs and the heading's edge (24px: the column's 12, the row's 12), as a
// chat app lists its recent chats; 32px rows (44 under a finger), a step under the sections' 36, at the sections'
// 13px and weights.
const ROW = 'relative flex h-8 min-w-0 items-center gap-1 rounded-control px-3 text-[13px] transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:h-11'

/**
 * The list's two quiet words, „Letzte Chats“ over it and „Alle Chats“ at its end, share one face: the group label's
 * step (12/16/500), muted, ink under the pointer, no fill (owner decision 2026-11-11: „Alle Chats“ at the rows' 13px
 * with a chevron read as one more chat). They name the list and its way on; the chats are the rows.
 */
const QUIET = 'text-muted-foreground hover:text-foreground text-meta flex items-center gap-1 rounded-control px-3 font-medium transition-colors duration-quick ease-out motion-reduce:transition-none'

/** Whether the reader folded „Letzte Chats“ away, per browser (a convenience, like the rail's width beside it). */
export const RECENT_CHATS_COLLAPSED_STORAGE_KEY = 'sidebar.recent-chats.collapsed'

function useRecentChatsCollapsed(): [boolean, () => void] {
  // Unfolded on the server and the first paint, then the reader's choice: no hydration mismatch.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(RECENT_CHATS_COLLAPSED_STORAGE_KEY) === '1')
    } catch {
      // Storage unavailable: the list stays open.
    }
  }, [])
  const toggle = useCallback(() => {
    setCollapsed((was) => {
      try {
        window.localStorage.setItem(RECENT_CHATS_COLLAPSED_STORAGE_KEY, was ? '0' : '1')
      } catch {
        // Storage unavailable: the fold holds for this page only.
      }
      return !was
    })
  }, [])
  return [collapsed, toggle]
}

/**
 * The project's last chats under the sections, headed „Letzte Chats“: the one part of the rail that scrolls, between
 * the sections and the office's doorways, which both stand still, with „Alle Chats“ at the end of the scroll. The
 * heading folds the list away and back (2026-11-11). Nothing for a project with none.
 */
export function RailChatList({ chats, pillId }: { chats: RailChats; pillId: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  const listId = useId()
  const [collapsed, toggle] = useRecentChatsCollapsed()
  if (chats.items.length === 0) return null
  return (
    <section aria-label={t('recentChats')} className={cn('mt-6 flex min-h-0 flex-col', !collapsed && 'flex-1')}>
      {/* The heading is the fold: the chevron points down while the list is open and right while it is folded. */}
      <h2 className="shrink-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-focus-inset
          data-testid="rail-chats-toggle"
          className={cn(QUIET, 'h-7 w-full')}
        >
          {t('recentChats')}
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none', collapsed && '-rotate-90')} aria-hidden />
        </button>
      </h2>
      {/* `p-px` (and `-mx-px`, so the rows keep their edge), because a scroll box clips on every side: with `py-px`
          alone the current row's 1px edge was cut at its left and right. The foot fades while more lies below. */}
      <ul id={listId} aria-label={t('recentChats')} hidden={collapsed} className="scroll-fade-bottom -mx-px flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-px" data-testid="rail-chats">
        {chats.items.map((chat) => (
          <li key={chat.id} className="relative shrink-0">
            <Link
              href={chat.href}
              title={chat.title}
              aria-current={chat.current ? 'page' : undefined}
              onClick={() => chats.onOpen?.(chat.id)}
              data-focus-inset
              className={cn(
                ROW,
                chat.current ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-selected hover:text-foreground active:bg-pressed'
              )}
            >
              {/* Where the reader is: the rail's one sheet, gliding here from „Chat“ (`railActivePillId`). */}
              {chat.current && (
                <motion.span layoutId={pillId} data-slot="rail-active-pill" aria-hidden className="bg-sheet absolute inset-0 rounded-control shadow-xs" transition={springGlide} />
              )}
              <span className="relative truncate">{chat.title}</span>
            </Link>
          </li>
        ))}
        {/* At the end of the scroll, as a chat app's „more“: reached after the last chat, in the heading's face. */}
        <li className="shrink-0">
          <Link href={chats.allHref} onClick={chats.onOpenAll} data-focus-inset data-testid="rail-all-chats" className={cn(QUIET, 'h-8 pointer-coarse:h-11')}>
            {t('allChats')}
          </Link>
        </li>
      </ul>
    </section>
  )
}

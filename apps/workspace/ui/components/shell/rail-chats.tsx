'use client'

/**
 * The project's last chats in the rail, under „Chat“ (design-language.md, „The app rail“).
 *
 * None of the pilot offices found the chat history (2026-11-10): its one door was an unlabelled glyph in the
 * chat's toolbar. The rail is where a person looks for a place, so the last few chats stand there as places, the
 * open one as the current place (the sheet), and „Alle Chats“ opens the whole history.
 *
 * The shell never imports a feature (module-seams.md), so the rows come in through {@link RailChatsSource}: the
 * chat's side (`RailChatsProvider` in `features/layout`) reads them from the chat store, the same rows its
 * history sheet lists, and the app layout puts it round the shell. Without a source the rail shows none.
 */

import type { JSX } from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import { ChevronRight, MessageCircleDashed } from 'lucide-react'

import { motion, springGlide } from '@/components/motion'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'

/** How many chats the rail lists: enough for the ones a person goes back to this week, few enough to stay a list of places. */
export const RAIL_CHAT_LIMIT = 5

export interface RailChat {
  id: string
  /** The title as the history shows it (a placeholder for an untitled chat, the neutral one for a locked chat). */
  title: string
  href: string
  /** The chat open on the page: the rail's current place. */
  current: boolean
  /** A temporary chat (ADR-0180): nothing from it is kept. Marked with the composer switch's glyph. */
  temporary?: boolean
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

// The rows' text starts on the sections' labels (51px: the column's 12, the row's 12, the glyph's 16, the gap's 11),
// so the chats hang under „Chat“ as its places; 32px rows (44 under a finger), a step under the sections' 36.
const ROW = 'relative flex h-8 min-w-0 items-center gap-1 rounded-control pl-[39px] pr-3 text-name transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:h-11'

/** The chats under „Chat“: an item of the sections' list holding its own list. Nothing for a project with none. */
export function RailChatList({ chats, pillId }: { chats: RailChats; pillId: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (chats.items.length === 0) return null
  return (
    <li className="list-none">
      <ul aria-label={t('recentChats')} className="flex flex-col gap-0.5 pt-0.5" data-testid="rail-chats">
        {chats.items.map((chat) => (
          <li key={chat.id} className="relative">
            <Link
              href={chat.href}
              title={chat.temporary ? t('temporaryChatTitle', { title: chat.title }) : chat.title}
              aria-current={chat.current ? 'page' : undefined}
              onClick={() => chats.onOpen?.(chat.id)}
              data-focus-inset
              className={cn(
                ROW,
                chat.current ? 'text-foreground font-semibold' : 'text-muted-foreground hover:bg-selected hover:text-foreground active:bg-pressed'
              )}
            >
              {/* Where the reader is: the rail's one sheet, gliding here from „Chat“ (`railActivePillId`). */}
              {chat.current && (
                <motion.span layoutId={pillId} data-slot="rail-active-pill" aria-hidden className="bg-sheet absolute inset-0 rounded-control shadow-xs" transition={springGlide} />
              )}
              <span className="relative truncate">{chat.title}</span>
              {chat.temporary && (
                <>
                  <MessageCircleDashed className="text-muted-foreground relative size-3.5 shrink-0" aria-hidden data-testid="rail-chat-temporary" />
                  <span className="sr-only">{t('temporaryChat')}</span>
                </>
              )}
            </Link>
          </li>
        ))}
        <li>
          <Link href={chats.allHref} onClick={chats.onOpenAll} data-focus-inset data-testid="rail-all-chats" className={cn(ROW, 'text-muted-foreground hover:bg-selected hover:text-foreground active:bg-pressed')}>
            <span className="truncate">{t('allChats')}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          </Link>
        </li>
      </ul>
    </li>
  )
}

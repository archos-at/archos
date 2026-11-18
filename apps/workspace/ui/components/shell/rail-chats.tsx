'use client'

import type { JSX } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, CircleAlert, Loader2, MessageCircleDashed, MessageCircleQuestion } from 'lucide-react'

import { motion, springGlide } from '@/components/motion'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'

export const RAIL_CHAT_LIMIT = 10

export interface RailChat {
  id: string
  title: string
  href: string
  current: boolean
  temporary?: boolean
  activity?: 'working' | 'waiting' | 'answered' | 'failed' | null
}

export interface RailChats {
  items: RailChat[]
  allHref: string
  onOpen?: (id: string) => void
  onOpenAll?: () => void
}

const RailChatsContext = createContext<RailChats | null>(null)

export const RailChatsSource = RailChatsContext.Provider

export function useRailChats(): RailChats | null {
  return useContext(RailChatsContext)
}

const ROW = 'relative flex h-8 min-w-0 items-center gap-1 rounded-control px-3 text-[13px] transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:h-11'

const QUIET = 'text-muted-foreground hover:text-foreground text-meta flex items-center gap-1 rounded-control px-3 font-medium transition-colors duration-quick ease-out motion-reduce:transition-none'

export const RECENT_CHATS_COLLAPSED_STORAGE_KEY = 'sidebar.recent-chats.collapsed'

function useRecentChatsCollapsed(): [boolean, () => void] {
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

const ACTIVITY_LABEL = { working: 'chatWorking', waiting: 'chatWaiting', answered: 'chatAnswered', failed: 'chatFailed' } as const

function RailChatActivity({ activity }: { activity: RailChat['activity'] }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (!activity) return null
  const mark = 'relative ml-auto size-3.5 shrink-0'
  return (
    <>
      {activity === 'working' && <Loader2 className={cn(mark, 'text-accent-primary animate-spin motion-reduce:animate-none')} aria-hidden data-testid="rail-chat-working" />}
      {activity === 'waiting' && <MessageCircleQuestion className={cn(mark, 'text-accent-primary')} aria-hidden data-testid="rail-chat-waiting" />}
      {activity === 'answered' && <span className="bg-primary relative ml-auto size-2 shrink-0 rounded-full" aria-hidden data-testid="rail-chat-answered" />}
      {activity === 'failed' && <CircleAlert className={cn(mark, 'text-destructive')} aria-hidden data-testid="rail-chat-failed" />}
      <span className="sr-only">{t(ACTIVITY_LABEL[activity])}</span>
    </>
  )
}

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
              title={chat.temporary ? t('temporaryChatTitle', { title: chat.title }) : chat.title}
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
              <span className={cn('relative truncate', (chat.activity === 'answered' || chat.activity === 'failed') && 'text-foreground font-medium')}>{chat.title}</span>
              <RailChatActivity activity={chat.activity} />
              {chat.temporary && (
                <>
                  <MessageCircleDashed className="text-muted-foreground relative size-3.5 shrink-0" aria-hidden data-testid="rail-chat-temporary" />
                  <span className="sr-only">{t('temporaryChat')}</span>
                </>
              )}
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

'use client'

import type { JSX } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, CircleAlert, Loader2, MessageCircleDashed, MessageCircleQuestion, MoreHorizontal, PencilLine, Trash2, Users } from 'lucide-react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { RailActivePill } from './rail-active-pill'

export const RAIL_CHAT_LIMIT = 8

export interface RailChat {
  id: string
  title: string
  href: string
  current: boolean
  temporary?: boolean
  projectId?: string | null
  shared?: boolean
  locked?: boolean
  activity?: 'working' | 'waiting' | 'answered' | 'failed' | null
}

export interface RailChats {
  items: RailChat[]
  chatOpen?: boolean
  allHref: string
  onOpen?: (id: string) => void
  onOpenAll?: () => void
  onRename?: (id: string, title: string) => void
  onDelete?: (id: string) => void
  onWarmOtherSide?: () => void
  more?: boolean
}

const RailChatsContext = createContext<RailChats | null>(null)

export const RailChatsSource = RailChatsContext.Provider

export function useRailChats(): RailChats | null {
  return useContext(RailChatsContext)
}

const ROW = 'relative flex h-7 min-w-0 items-center gap-1 rounded-control px-3 text-[13px] transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:h-11'

const QUIET = 'text-subtle hover:text-foreground text-meta flex items-center gap-1 rounded-control px-3 font-medium transition-colors duration-quick ease-out motion-reduce:transition-none'

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

function RailChatMenu({ chat, chats, onRename }: { chat: RailChat; chats: RailChats; onRename: () => void }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (!chats.onRename && !chats.onDelete) return null
  const busy = chat.activity === 'working'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('chatActions', { title: chat.title })}
          data-testid="rail-chat-menu"
          className="text-muted-foreground hover:text-foreground hover:bg-hover absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-control opacity-0 transition-opacity duration-quick ease-out focus-visible:opacity-100 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {chats.onRename && !chat.locked && (
          <DropdownMenuItem disabled={busy} onSelect={onRename} data-testid="rail-chat-rename">
            <PencilLine className="size-4" aria-hidden />
            {t('chatRename')}
          </DropdownMenuItem>
        )}
        {chats.onDelete && (
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => chats.onDelete?.(chat.id)} data-testid="rail-chat-delete">
            <Trash2 className="size-4" aria-hidden />
            {t('chatDelete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RailChatRename({ chat, onDone }: { chat: RailChat; onDone: (title: string | null) => void }): JSX.Element {
  const t = useTranslations(navCopy)
  const [title, setTitle] = useState(chat.title)
  return (
    <input
      autoFocus
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => onDone(title)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(title)
        if (event.key === 'Escape') onDone(null)
      }}
      aria-label={t('chatRenameInput')}
      data-testid="rail-chat-rename-input"
      className="bg-card text-foreground h-8 w-full rounded-control border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:text-base"
    />
  )
}

export function RailChatList({ chats, pillId }: { chats: RailChats; pillId: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  const listId = useId()
  const [collapsed, toggle] = useRecentChatsCollapsed()
  const [renaming, setRenaming] = useState<string | null>(null)
  const finishRename = (chat: RailChat, title: string | null): void => {
    setRenaming(null)
    const next = title?.trim()
    if (next && next !== chat.title) chats.onRename?.(chat.id, next)
  }
  if (chats.items.length === 0) return null
  return (
    <section aria-label={t('recentChats')} className={cn('mt-8 flex min-h-0 flex-col', !collapsed && 'flex-1')}>
      {/* The heading is the fold: the chevron points down while the list is open and right while it is folded. */}
      <h2 className="shrink-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-focus-inset
          data-testid="rail-chats-toggle"
          className={cn(QUIET, 'group/heading mb-0.5 h-6 w-full pointer-coarse:h-11')}
        >
          {t('recentChats')}
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-[rotate,opacity] duration-quick ease-out motion-reduce:transition-none',
              collapsed ? '-rotate-90' : 'opacity-0 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100 pointer-coarse:opacity-100'
            )}
            aria-hidden
          />
        </button>
      </h2>
      {/* `p-px` (and `-mx-px`, so the rows keep their edge), because a scroll box clips on every side: with `py-px`
          alone the current row's 1px edge was cut at its left and right. The foot fades while more lies below. */}
      <ul id={listId} aria-label={t('recentChats')} hidden={collapsed} className="scroll-fade-bottom -mx-px flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-px" data-testid="rail-chats">
        {chats.items.map((chat) => (
          <li key={chat.id} className="group/chat relative shrink-0">
            {renaming === chat.id ? (
              <RailChatRename chat={chat} onDone={(title) => finishRename(chat, title)} />
            ) : (
            <>
            <Link
              href={chat.href}
              title={chat.temporary ? t('temporaryChatTitle', { title: chat.title }) : chat.title}
              aria-current={chat.current ? 'page' : undefined}
              onClick={() => chats.onOpen?.(chat.id)}
              data-focus-inset
              className={cn(
                ROW,
                (chats.onRename || chats.onDelete) && 'group-hover/chat:pr-8 group-focus-within/chat:pr-8 pointer-coarse:pr-12',
                chat.current ? 'text-foreground font-medium' : 'text-subtle hover:bg-selected hover:text-foreground active:bg-pressed'
              )}
            >
              {/* Where the reader is: the rail's one sheet, gliding here from „Chat“ (`railActivePillId`). */}
              {chat.current && (
                <RailActivePill pillId={pillId} at={chat.id} />
              )}
              <span className={cn('relative min-w-0 flex-1 truncate', (chat.activity === 'answered' || chat.activity === 'failed') && 'text-foreground font-medium')}>{chat.title}</span>
              <RailChatActivity activity={chat.activity} />
              {chat.shared && (
                <>
                  <Users className="relative size-3.5 shrink-0" aria-hidden data-testid="rail-chat-shared" />
                  <span className="sr-only">{t('sharedChat')}</span>
                </>
              )}
              {chat.temporary && (
                <>
                  <MessageCircleDashed className="text-muted-foreground relative size-3.5 shrink-0" aria-hidden data-testid="rail-chat-temporary" />
                  <span className="sr-only">{t('temporaryChat')}</span>
                </>
              )}
            </Link>
            <RailChatMenu chat={chat} chats={chats} onRename={() => setRenaming(chat.id)} />
            </>
            )}
          </li>
        ))}
        {/* After the last chat, as a chat app's „more“, only while there are more: in the heading's face. */}
        {chats.more && (
          <li className="shrink-0">
            <Link href={chats.allHref} onClick={chats.onOpenAll} data-focus-inset data-testid="rail-all-chats" className={cn(QUIET, 'h-7 pointer-coarse:h-11')}>
              {t('allChats')}
            </Link>
          </li>
        )}
      </ul>
    </section>
  )
}

'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { MessageCircleDashed, Users } from 'lucide-react'

import { Item, ItemList } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import type { RailChat } from '@/components/shell/rail-chats'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'

export const PHONE_RECENT_CHATS = 5

export function RecentChatsSection({ chats, onOpen }: { chats: readonly RailChat[]; onOpen: (id: string) => void }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (chats.length === 0) return null
  return (
    <section aria-label={t('recentChats')} className="mb-4 flex flex-col gap-1.5" data-testid="sessions-recent-chats">
      <SectionLabel className="block pb-1.5 pt-1">{t('recentChats')}</SectionLabel>
      <ItemList as="ul" className="border-0 bg-card shadow-xs">
        {chats.map((chat) => (
          <Item
            key={chat.id}
            asChild
            className={cn('relative min-h-11 items-center gap-3', chat.current ? 'bg-selected ring-border ring-1 ring-inset' : 'hover:bg-hover focus-within:bg-hover')}
          >
            <li>
              <Link
                href={chat.href}
                onClick={() => onOpen(chat.id)}
                aria-current={chat.current ? 'page' : undefined}
                title={chat.temporary ? t('temporaryChatTitle', { title: chat.title }) : chat.title}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control text-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className={cn('min-w-0 flex-1 truncate', chat.current ? 'font-medium' : 'text-foreground')}>{chat.title || t('newChat')}</span>
                {chat.shared && (
                  <>
                    <Users className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                    <span className="sr-only">{t('sharedChat')}</span>
                  </>
                )}
                {chat.temporary && (
                  <>
                    <MessageCircleDashed className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                    <span className="sr-only">{t('temporaryChat')}</span>
                  </>
                )}
              </Link>
            </li>
          </Item>
        ))}
      </ItemList>
    </section>
  )
}

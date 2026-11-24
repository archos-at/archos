'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { projectIdFromPathname } from '@/components/shell/org-sections'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { RailChatsProvider } from '@/features/layout/components/rail-chats-provider'

const USER_ID = 'dev-user'
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000)

const TITLES = [
  'Rettungswege Bürogebäude GK4 Wien',
  'Fluchtweglänge im Erdgeschoss',
  'Brandabschnitte Tiefgarage und Rampe zur Zufahrt Nord',
  'Sicherheitstreppenhaus — Anforderungen GK5',
  'Barrierefreiheit Sanitärräume',
  'Schallschutz Trennwände Wohnbau',
  'Stellplatzverpflichtung Wien Bauordnung',
  'Abstandsflächen zur Nachbargrundgrenze',
  'Bebauungsplan 7B — zulässige Gebäudehöhe',
  'Wärmeschutz Außenwand OIB-RL 6',
  'Dachausbau — Fluchtweg über Dachterrasse',
  'Kinderspielplatz Pflicht ab wie vielen Wohnungen',
  'Aufzug Mindestmaße Kabine',
  'Belichtung Aufenthaltsräume Souterrain',
  'Fahrradabstellplätze Wiener Garagengesetz',
  'Lüftung innenliegender Bäder',
  'Brandschutz Holzfassade GK4',
  'Einreichplan — fehlende Unterlagen',
]

const PROJECT_OF_CHAT = [null, 'p-1', 'p-1', null, 'p-2'] as const

const conversation = (title: string, index: number): Conversation => ({
  id: `chat-${index + 1}`,
  userId: USER_ID,
  projectId: PROJECT_OF_CHAT[index % PROJECT_OF_CHAT.length],
  shared: index === 2 || index === 3,
  title,
  messages: [],
  createdAt: hoursAgo(index * 20 + 2),
  updatedAt: hoursAgo(index * 20 + 1),
})

export function DevRailChats({ pathname, empty = false, children }: { pathname: string; empty?: boolean; children: ReactNode }): JSX.Element {
  const projectId = projectIdFromPathname(pathname)
  const [real] = useState(() => {
    const loader = useChatStore.getState().loadServerConversations
    useChatStore.setState({ loadServerConversations: async () => {} })
    return loader
  })
  useEffect(
    () => () => {
      useChatStore.setState({ loadServerConversations: real })
    },
    [real]
  )
  useEffect(() => {
    const conversations = empty ? [] : TITLES.map(conversation)
    const listing = { ids: conversations.map((c) => c.id), since: Date.now() }
    const serverSides = Object.fromEntries(['personal:', 'project:p-1', 'project:p-2'].map((key) => [key, listing]))
    useChatStore.setState({ currentUserId: USER_ID, projectId, conversations, currentConversation: conversations[1] ?? null, serverSides })
  }, [empty, projectId])
  return <RailChatsProvider pathname={pathname}>{children}</RailChatsProvider>
}

'use client'

/**
 * A project's chat history for a preview of the rail: the chat store seeded with the reader's chats in the previewed project
 * (newest first: enough that the rail's „Letzte Chats“ scroll at a laptop's height, „Alle Chats“ the whole history), and the rail's source round the page, lit for the
 * route the preview names. `?chats=empty` is a project nobody has chatted in yet: the rail shows no „Letzte Chats“. The open chat is the newest but one, so the shot shows the current place below the top row.
 */

import type { JSX, ReactNode } from 'react'
import { useEffect } from 'react'

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

const conversation = (projectId: string) => (title: string, index: number): Conversation => ({
  id: `chat-${index + 1}`,
  userId: USER_ID,
  projectId,
  title,
  messages: [],
  createdAt: hoursAgo(index * 20 + 2),
  updatedAt: hoursAgo(index * 20 + 1),
})

export function DevRailChats({ pathname, empty = false, children }: { pathname: string; empty?: boolean; children: ReactNode }): JSX.Element {
  const projectId = projectIdFromPathname(pathname) ?? 'p-1'
  useEffect(() => {
    const conversations = empty ? [] : TITLES.map(conversation(projectId))
    useChatStore.setState({ currentUserId: USER_ID, projectId, conversations, currentConversation: conversations[1] ?? null })
  }, [empty, projectId])
  return <RailChatsProvider pathname={pathname}>{children}</RailChatsProvider>
}

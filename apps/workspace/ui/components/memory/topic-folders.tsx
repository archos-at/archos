'use client'

/**
 * A shelf's notes as folders by topic (ADR-0180, topics amendment): one
 * collapsible group per topic, in the order the shelf's topic summary gives
 * (most notes first), and the notes without a topic last. Domain-free on the
 * note: the caller renders a row (`renderItem`) and what a topic can do
 * (`renderTopicActions`, rename, merge, remove), so a person's shelf and a
 * project's shelf list the same folders.
 */

import type { JSX, ReactNode } from 'react'
import { Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CountPill } from '@/components/ui/count-pill'
import { ItemList } from '@/components/ui/item'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'

export interface TopicFoldersProps<T extends { id: string; topic: string | null }> {
  /** The notes the reader sees on the shelf, in the order their rows should keep. */
  items: T[]
  /** The shelf's topics with how many notes each holds, in the order the folders show. */
  topics: { name: string; count: number }[]
  renderItem: (item: T) => ReactNode
  /** The actions of a folder's heading; `null` is the folder of notes without a topic. */
  renderTopicActions?: (topic: string | null) => ReactNode
  /** Whether the folders start open. */
  defaultOpen?: boolean
}

interface FolderGroup<T> {
  /** The topic's name, or null for the notes without one. */
  topic: string | null
  count: number
  items: T[]
}

/**
 * The notes sorted into their topic's group, the summary's order kept. A topic the
 * notes hold and the summary lacks gets its own group after the summary's, counted
 * by its notes, so no note is dropped; the notes without a topic come last.
 */
function groupByTopic<T extends { topic: string | null }>(
  items: T[],
  topics: { name: string; count: number }[]
): FolderGroup<T>[] {
  const byTopic = new Map<string, T[]>()
  const unfiled: T[] = []
  for (const item of items) {
    const name = item.topic ?? null
    if (name === null) {
      unfiled.push(item)
      continue
    }
    byTopic.set(name, [...(byTopic.get(name) ?? []), item])
  }
  const summarized = new Set(topics.map(({ name }) => name))
  const named = topics.flatMap(({ name, count }) => {
    const group = byTopic.get(name)
    return group ? [{ topic: name, count, items: group }] : []
  })
  const unlisted = [...byTopic]
    .filter(([name]) => !summarized.has(name))
    .map(([name, group]) => ({ topic: name, count: group.length, items: group }))
  const groups = [...named, ...unlisted]
  return unfiled.length > 0 ? [...groups, { topic: null, count: unfiled.length, items: unfiled }] : groups
}

export function TopicFolders<T extends { id: string; topic: string | null }>({
  items,
  topics,
  renderItem,
  renderTopicActions,
  defaultOpen = true,
}: TopicFoldersProps<T>): JSX.Element {
  const t = useTranslations(memoryTopicsCopy)
  return (
    <div className="space-y-4" data-testid="topic-folders">
      {groupByTopic(items, topics).map((group) => (
        <Collapsible key={group.topic ?? ''} defaultOpen={defaultOpen} data-testid="topic-folder">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0">
              <CollapsibleTrigger className="group/folder hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
                <ChevronDown
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=closed]/folder:-rotate-90 motion-reduce:transition-none"
                  aria-hidden
                />
                <span className="[overflow-wrap:anywhere]">{group.topic ?? t('noTopic')}</span>
                <CountPill tone="muted">{t('topicCount', { count: group.count })}</CountPill>
              </CollapsibleTrigger>
            </h3>
            {renderTopicActions?.(group.topic)}
          </div>
          <CollapsibleContent>
            <ItemList className="mt-2">
              {group.items.map((item) => (
                <Fragment key={item.id}>{renderItem(item)}</Fragment>
              ))}
            </ItemList>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}

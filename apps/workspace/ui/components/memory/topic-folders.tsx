'use client'

import type { JSX, ReactNode } from 'react'
import { Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CountPill } from '@/components/ui/count-pill'
import { ItemList } from '@/components/ui/item'
import { useTranslations } from '@/i18n'
import { memoryTopicsCopy } from '@/i18n/namespaces/memory-topics'

export interface TopicFoldersProps<T extends { id: string; topic: string | null }> {
  items: T[]
  topics: { name: string; count: number }[]
  renderItem: (item: T) => ReactNode
  renderTopicActions?: (topic: string | null) => ReactNode
  defaultOpen?: boolean
}

interface FolderGroup<T> {
  topic: string | null
  count: number
  items: T[]
}

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
  if (items.every((item) => item.topic === null)) {
    return (
      <ItemList data-testid="topic-folders">
        {items.map((item) => (
          <Fragment key={item.id}>{renderItem(item)}</Fragment>
        ))}
      </ItemList>
    )
  }
  return (
    <div className="space-y-4" data-testid="topic-folders">
      {groupByTopic(items, topics).map((group) => (
        <Collapsible key={group.topic ?? ''} defaultOpen={defaultOpen} data-testid="topic-folder">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0">
              <CollapsibleTrigger className="group/folder hover:bg-hover focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
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

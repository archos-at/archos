import { pageOfList, type OffsetPage, type PageOf } from '@/lib/api/offset-page'
import { distinctTopicNames, resolveTopic } from './topic'

export function pageOfTopic<T extends { topic: string | null }>(
  items: readonly T[],
  topic: string,
  page: OffsetPage
): PageOf<T> {
  const wanted = resolveTopic(topic, distinctTopicNames(items))
  const onTopic = items.filter((item) => item.topic === wanted)
  const { rows, nextCursor } = pageOfList(onTopic, page)
  return { items: rows, nextCursor }
}

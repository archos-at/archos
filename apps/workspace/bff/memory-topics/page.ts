/**
 * The memory topic filter of a list (ADR-0180): the page of a list's items on one topic.
 * Kept apart from `topic.ts`, which the agent-door catalog and the wire schemas import, so a
 * schema never pulls in the paging helper.
 */

import { pageOfList, type OffsetPage, type PageOf } from '@/lib/api/offset-page'
import { distinctTopicNames, resolveTopic } from './topic'

/**
 * One page of a list's visible items, filtered to a topic: the items of that
 * topic in the order given, then the page. The filter runs after visibility, on
 * the items the reader may see; a topic only restricted notes hold selects nothing.
 * `topic` is the query's text; the empty string (no topic, as `resolveTopic` reads it)
 * selects the notes with no topic.
 */
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

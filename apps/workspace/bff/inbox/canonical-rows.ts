import type { InboxItem, InboxItemType, NewInboxItem } from '@/lib/db/schema/inbox'
import { canonicalInboxType } from './types'

export type CanonicalInboxItem<T extends InboxItem = InboxItem> = Omit<T, 'type'> & { type: InboxItemType }

export function canonicalItem<T extends InboxItem>(row: T): CanonicalInboxItem<T> {
  return { ...row, type: canonicalInboxType(row.type) }
}

export async function canonicalRows<T extends InboxItem>(rows: PromiseLike<T[]>): Promise<CanonicalInboxItem<T>[]> {
  return (await rows).map(canonicalItem)
}

export function storedItem(values: NewInboxItem): NewInboxItem {
  return { ...values, type: canonicalInboxType(values.type) }
}

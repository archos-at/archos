import 'server-only'

export { INBOX_LIST_LIMIT } from './types'
export type { InboxListFilter } from './types'

export {
  deleteItemsForResource,
  deleteOrphanedInboxItems,
  pruneInboxItemsOlderThan,
  upsertInboxItem,
  upsertInboxItems,
} from './inbox-item-writes'

export {
  countInboxFilters,
  countPendingInboxItems,
  findInboxItemForRecipient,
  findLiveInboxGroupKeys,
  listInboxItems,
  listInboxTypesForRecipient,
  listTouchedOfType,
  listUnreadAnchors,
  openRecipientsOfGroup,
  readGroupPayloads,
  recipientsHoldingGroup,
  UNREAD_ANCHORS_LIMIT,
} from './inbox-item-queries'
export type { InboxCursor, InboxFilterCounts, ListedInboxItem, ListInboxOptions } from './inbox-item-queries'

export { EVERY_INBOX_TYPE } from './inbox-item-predicates'
export type { InboxTypeScope } from './inbox-item-predicates'

export {
  archiveInboxItem,
  archiveInboxItemsOfType,
  markAllInboxItemsRead,
  markAnchorItemsRead,
  markInboxItemsRead,
  markInboxItemsUnread,
  markResourceItemsRead,
  unarchiveInboxItem,
} from './inbox-item-state-changes'

export {
  markItemsInertAnchoredOn,
  markItemsInertForResource,
  markItemsInertForSubjectInProject,
  markItemsInertForSubjectRow,
  refreshOpenGroupItems,
  resolveInboxItemsForTargets,
  resolveOpenItemsAnchoredOn,
  resolveOpenItemsOfType,
  retractOccurrenceAnchoredOn,
  rewriteItemPayloadsAnchoredOn,
} from './inbox-item-lifecycle'
export type { AnchoredRows, InboxResolutionTarget, OpenGroupRefresh, OpenItemsOfType } from './inbox-item-lifecycle'

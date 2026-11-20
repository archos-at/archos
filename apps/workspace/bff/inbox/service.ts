import 'server-only'

export type { InboxEmission } from './inbox-emission'
export { emitInboxItems, upsertWaves } from './inbox-emission'
export {
  markInboxItemsInertAnchoredOn,
  markItemsInertForDeletedResource,
  markItemsInertForSubject,
  openRecipientsOf,
  resolveInboxItemsAnchoredOn,
  resolveInboxItemsFor,
  resolveInboxItemsOfType,
  retractInboxOccurrenceAnchoredOn,
  rewriteInboxPayloadsAnchoredOn,
} from './inbox-resolution'
export { INBOX_LIST_LIMIT } from './repository'
export type { InboxResolutionTarget } from './repository'
export type { ListInboxParams } from './inbox-listing'
export { getInboxSummary, listInbox, unreadAnchorsFor, viewInboxItemAs } from './inbox-listing'
export { decodeInboxCursor, encodeInboxCursor } from './inbox-cursor'
export type { InboxMutationResult } from './types'
export {
  archiveItem,
  markAllRead,
  markAnchorItemsReadFor,
  markMarksSetReadFor,
  markRead,
  markResourceItemsReadFor,
  markUnread,
  unarchiveItem,
} from './inbox-mutations'

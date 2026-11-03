/**
 * SQL for the E-Mail-Eingang (ADR-0137, migration 0194). No authorization
 * here: the service decides who may ask, and row-level security is the
 * backstop. Every list is bounded.
 *
 * Every function runs in the tenant scope its caller opened, with one exception
 * that says so: {@link findActiveAddressByToken} is the lookup that happens
 * BEFORE any organization is known, and its caller wraps it in
 * `withPlatformAccess`. A function that may run inside a caller's transaction
 * takes its executor rather than calling `getDb()` (`transaction-shape.spec.ts`).
 *
 * The rules a row must keep (a waiting mail was scanned, a member is named
 * exactly when the From address is one, a settled or dropped mail names no
 * third party, every object key is the row's own) are CHECKs in the migration.
 * The functions here write rows that keep them, and a row that does not is a
 * refused statement rather than a quiet inconsistency.
 *
 * This module is the one entry its callers import, and it holds no SQL of its
 * own: each caller's statements live in a module of their own, re-exported
 * here. `./reception-repository.ts` is the webhook's,
 * `./receive-repository.ts` the receive job's, `./address-repository.ts` the
 * project's address, `./review-read-repository.ts` the E-Mail-Eingang's lists
 * and lookups, and `./decision-repository.ts` a person's decisions and the
 * agent's suggestions. The filing job, the notices and the sweeps keep their
 * own (`./filing-repository.ts`, `./notice-repository.ts`,
 * `./sweep-repository.ts`).
 */

import 'server-only'

export {
  completeReception,
  findActiveAddressByToken,
  findMailIdByDeliveryKey,
  forgetReceptionObject,
  insertReception,
  type NewReception,
  queueReceiveJob,
  type ReceptionOutcome,
  type ResolvedInboundAddress,
  type StagedBytes,
  stagedBytes,
} from './reception-repository'

export {
  dropMail,
  type FiledMessage,
  findAddressToken,
  findFiledMessages,
  findMailForReceive,
  findPartSummaries,
  findScreenedDuplicates,
  findScreenedNamesakes,
  findThreadCandidates,
  findThreadFollowContext,
  type HeldMailFields,
  holdMail,
  keepReceiveProgress,
  markNotified,
  type PartSummary,
  recordRawScan,
  type StoredScan,
  type ThreadFollowContext,
  type ThreadKeys,
} from './receive-repository'

export {
  addressActivity,
  type AddressChange,
  type AddressConflict,
  type AddressWrite,
  type EndedFollow,
  endProjectFollows,
  findActiveAddress,
  insertAddress,
  type NewAddress,
  ownDomainVerifiedShare,
  type ProjectFollowEnd,
  replaceAddress,
  switchOffAddress,
} from './address-repository'

export {
  type CandidateDocument,
  countWaitingMailsByProject,
  findCandidateDocuments,
  findDocumentIdByStoredName,
  findFollowDeciders,
  findLiveFolders,
  findMailParts,
  findProjectMail,
  findThreadDocuments,
  findVersionNumbers,
  listProjectMails,
  type MailListPosition,
  type MailListRow,
  type ThreadDocument,
} from './review-read-repository'

export {
  type DecisionActor,
  type DecisionsWritten,
  dismissMails,
  type FilingJob,
  findPartKinds,
  hasOpenParts,
  MailChangedError,
  type MailDecisionWrite,
  markDecisionsAudited,
  PartNotWaitingError,
  restoreMailParts,
  storePartSuggestions,
  writeMailDecisions,
} from './decision-repository'

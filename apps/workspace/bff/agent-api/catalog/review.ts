/** The review operations (ADR-0122). See `projects.ts` for the shape and `docs/architecture/agent-surface.md` for the rules. */

import { quarantineDecisionsSchema } from '@/lib/upload-screening/decisions-wire'
import { z } from 'zod'
import {
  createAnnotationRequestSchema,
  createReplyRequestSchema,
  documentThreadRequestSchema,
  updateAnnotationRequestSchema,
  updateReplyRequestSchema,
} from '@/lib/annotations/types'
import { revisionLinkSchema } from '@/lib/documents/document-wire'
import { measureRequestSchema } from '@/lib/drawing-tape/wire'
import {
  approveRequestSchema,
  reviewQueueQuerySchema,
  forkDraftRequestSchema,
  refuseRequestSchema,
  replaceContentRequestSchema,
  submitRequestSchema,
} from '@/lib/documents/lifecycle-types'
import { revisionCandidatesRequestSchema } from '@/lib/documents/name-probe-types'
import { revisionCompareBodySchema } from '@/lib/documents/revision-compare-types'
import {
  ANNOTATION_EXPORT_FORMATS,
  ANNOTATION_EXPORT_REVISIONS,
  ANNOTATION_EXPORT_SCOPES,
} from '@/lib/annotations/export-request'
import { projectProtocolQuerySchema } from '@/lib/annotations/project-types'
import { listCalibrationsQuerySchema, setCalibrationRequestSchema } from '@/lib/drawing-calibrations/wire'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { AgentOperation } from '../operation'
import { PRODUCT_NAME } from '@/lib/brand'

const documentParams = z.object({
  id: z.string().describe('The document id, from a project document listing or workspace-search.'),
})

const projectParams = z.object({ id: z.string().describe('The project id, from project-list.') })

const versionParams = documentParams.extend({
  versionId: z.string().describe('The version id, from document-version-list.'),
})

const annotationParams = documentParams.extend({
  annotationId: z.string().describe('The annotation id, from annotation-list.'),
})

const calibrationParams = documentParams.extend({
  calibrationId: z.string().describe('The calibration id, from drawing-calibration-list.'),
})

const replyParams = annotationParams.extend({
  replyId: z.string().describe('The reply id, from the annotation’s `replies` in annotation-get.'),
})

/**
 * `GET …/versions/diff` reads `from` and `to` straight off the URL (the route
 * has no query schema), so this one is written for the agent; the route
 * answers 400 when either is missing.
 */
const versionDiffQuery = z.object({
  from: z.string().describe('The version id to compare from, from document-version-list.'),
  to: z.string().describe('The version id to compare to, from document-version-list.'),
})

export const reviewOperations = [
  {
    name: 'document-review-list',
    domain: 'review',
    summary: 'List what waits for the person’s review, across projects',
    description:
      'Versions in review waiting for the person’s decision (`role: reviewer`, default) or sent by them (`submitter`), newest first, ' +
      'across projects. `documentId` and `versionId` feed document-version-get and the decisions.',
    method: 'GET',
    path: '/api/review/queue',
    query: reviewQueueQuerySchema,
    spansProjects: 'unlessScoped',
    load: () => import('@/app/api/review/queue/route'),
  },
  // ---- Versions: the document lifecycle (draft, in review, approved, published) ----
  {
    name: 'document-version-list',
    domain: 'review',
    summary: 'List a document’s versions',
    description:
      'Every version of a document with its lifecycle state, author and content hash. Start here for a `versionId`.',
    method: 'GET',
    path: '/api/documents/[id]/versions',
    params: documentParams,
    load: () => import('@/app/api/documents/[id]/versions/route'),
  },
  {
    name: 'document-version-fork',
    domain: 'review',
    summary: 'Start a new draft from the published version',
    description:
      'Forks an editable draft from the published version and returns it; empty body. Next: document-version-content-replace, then document-version-submit.',
    method: 'POST',
    path: '/api/documents/[id]/versions',
    params: documentParams,
    body: forkDraftRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/route'),
  },
  {
    name: 'document-version-get',
    domain: 'review',
    summary: 'Read one version’s state',
    description:
      'One version of a document: lifecycle state, author, reviewers, decisions and `contentHash` (the `ifMatch` value for edits and decisions).',
    method: 'GET',
    path: '/api/documents/[id]/versions/[versionId]',
    params: versionParams,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/route'),
  },
  {
    name: 'document-version-content-get',
    domain: 'review',
    summary: 'Read the text of a version',
    description: 'The full text of one version of a draft-type document, as plain text. Use document-version-diff to compare two versions.',
    method: 'GET',
    path: '/api/documents/[id]/versions/[versionId]/content',
    params: versionParams,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/content/route'),
  },
  {
    name: 'document-version-content-replace',
    domain: 'review',
    summary: 'Replace the text of a draft version',
    description:
      'Writes the whole body of a draft version. `ifMatch` is the `contentHash` last read (document-version-get); a mismatch is a 409. Drafts only. Next: document-version-submit.',
    method: 'PUT',
    path: '/api/documents/[id]/versions/[versionId]/content',
    params: versionParams,
    body: replaceContentRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/content/route'),
  },
  {
    name: 'document-version-diff',
    domain: 'review',
    summary: 'Compare the text of two versions',
    description:
      'Both versions (state and full text) side by side, `from` and `to`, ids from document-version-list.',
    method: 'GET',
    path: '/api/documents/[id]/versions/diff',
    params: documentParams,
    query: versionDiffQuery,
    load: () => import('@/app/api/documents/[id]/versions/diff/route'),
  },
  {
    name: 'document-version-reviewer-list',
    domain: 'review',
    summary: 'List who can be asked to review a document',
    description:
      'The colleagues who hold edit rights on the document’s project and can be named as reviewers. ' +
      'Their user ids go into `reviewerUserIds` of document-version-submit.',
    method: 'GET',
    path: '/api/documents/[id]/versions/reviewers',
    params: documentParams,
    load: () => import('@/app/api/documents/[id]/versions/reviewers/route'),
  },
  {
    name: 'document-version-submit',
    domain: 'review',
    summary: 'Send a draft version to review',
    description:
      'Submits a draft for review. `reviewerUserIds` (from document-version-reviewer-list; empty asks the assignees), `orderMessage` the one-sentence order, `dueAt` optional. ' +
      'Reviewers then approve, reject or request changes.',
    method: 'POST',
    path: '/api/documents/[id]/versions/[versionId]/submit',
    params: versionParams,
    body: submitRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/submit/route'),
  },
  {
    name: 'document-version-approve',
    domain: 'review',
    summary: 'Approve a version under review',
    description:
      'Approves a version in review. `ifMatch` is the `contentHash` the reviewer read; a mismatch is a 409. Next: document-version-publish.',
    method: 'POST',
    path: '/api/documents/[id]/versions/[versionId]/approve',
    params: versionParams,
    body: approveRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/approve/route'),
  },
  {
    name: 'document-version-reject',
    domain: 'review',
    summary: 'Reject a version under review',
    description:
      'Refuses a version in review. A `comment` saying why is required; `ifMatch` is the `contentHash` the reviewer read.',
    method: 'POST',
    path: '/api/documents/[id]/versions/[versionId]/reject',
    params: versionParams,
    body: refuseRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/reject/route'),
  },
  {
    name: 'document-version-request-changes',
    domain: 'review',
    summary: 'Ask for changes on a version under review',
    description:
      'Sends a version in review back for rework. `comment` is required; `delegateRevision` hands the rework to ' + PRODUCT_NAME + ' as a task.',
    method: 'POST',
    path: '/api/documents/[id]/versions/[versionId]/changes',
    params: versionParams,
    body: refuseRequestSchema,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/changes/route'),
  },
  {
    name: 'document-version-publish',
    domain: 'review',
    summary: 'Publish an approved version',
    description:
      'Makes an approved version the document’s current published revision; the previous published version is superseded. Send no body.',
    method: 'POST',
    path: '/api/documents/[id]/versions/[versionId]/publish',
    params: versionParams,
    load: () => import('@/app/api/documents/[id]/versions/[versionId]/publish/route'),
  },

  // ---- Annotations: marks and their threads on a document ----
  {
    name: 'annotation-list',
    domain: 'review',
    summary: 'List the annotations on a document',
    description:
      'Every annotation on the document with its place, status, assignee and replies, including ' + PRODUCT_NAME + '’s open proposals. ' +
      'The ids feed annotation-get.',
    method: 'GET',
    path: '/api/documents/[id]/annotations',
    params: documentParams,
    load: () => import('@/app/api/documents/[id]/annotations/route'),
  },
  {
    name: 'annotation-create',
    domain: 'review',
    summary: 'Place an annotation on a document',
    description:
      'Sets an annotation at a place on the document (page position or text range) with a kind and a body. ' +
      'Returns it with its number. Colleagues in `mentions` are told. With `shape` `line`, `path` or `polygon` and `points` ' +
      'it keeps a measurement on a PDF drawing: the server measures those points itself and stores the value with its interval ' +
      'and provenance, and refuses where there is no number.',
    method: 'POST',
    path: '/api/documents/[id]/annotations',
    params: documentParams,
    body: createAnnotationRequestSchema,
    examples: [
      {
        params: { id: '5b1e7c2a-9d4f-4c3b-8a6e-2f1d0c9b8a7e' },
        // A region in page shares (origin top left); a point has x and y only.
        body: { page: 2, shape: 'region', x: 0.42, y: 0.31, w: 0.18, h: 0.12, kind: 'question', body: 'Is this door 90 cm clear?' },
      },
    ],
    load: () => import('@/app/api/documents/[id]/annotations/route'),
  },
  {
    name: 'document-measure',
    domain: 'review',
    summary: 'Measure a distance, a path or an area on a page of a PDF drawing, or snap points to its linework',
    description:
      'Measures between points on a page of the document’s current version, from the file’s own linework: `distance` (two points), ' +
      '`path` (two or more) or `area` (three or more corners in order); `snap` returns where each point is tied to a line end or ' +
      'corner, or the candidates when several are in reach. Points are shares of the page as shown, 0 to 1, origin top left. ' +
      'Returns a measurement with its interval, provenance and scale state, or no number with a `code` (for example `uncalibrated`, ' +
      '`several_in_reach`, `two_regions`), the reason and the remedy. ' +
      'State a number with its interval and provenance; never recompute, round or convert one. Read-only: keep a measurement ' +
      'on the sheet with annotation-create.',
    method: 'POST',
    path: '/api/documents/[id]/measure',
    params: documentParams,
    body: measureRequestSchema,
    readOnly: true,
    feature: FEATURE_FLAGS.drawingMeasure,
    examples: [
      {
        params: { id: '5b1e7c2a-9d4f-4c3b-8a6e-2f1d0c9b8a7e' },
        body: { page: 1, operation: 'distance', points: [[0.21, 0.4], [0.36, 0.4]] },
      },
    ],
    load: () => import('@/app/api/documents/[id]/measure/route'),
  },
  {
    name: 'annotation-get',
    domain: 'review',
    summary: 'Read one annotation with its thread',
    description: 'One annotation with its whole reply thread, status and carry links (id from annotation-list).',
    method: 'GET',
    path: '/api/documents/[id]/annotations/[annotationId]',
    params: annotationParams,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/route'),
  },
  {
    name: 'annotation-update',
    domain: 'review',
    summary: 'Change, resolve or reassign an annotation',
    description:
      'Rewords, assigns, dates or moves the status (open, resolved, dismissed) of an annotation; send at least one field. ' +
      '`expectedStatus` guards against overwriting a colleague’s change; `carryToCurrent` carries it onto the current revision.',
    method: 'PATCH',
    path: '/api/documents/[id]/annotations/[annotationId]',
    params: annotationParams,
    body: updateAnnotationRequestSchema,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/route'),
  },
  {
    name: 'annotation-delete',
    domain: 'review',
    summary: 'Delete one of your own annotations',
    description:
      'Deletes an annotation its author set, permanently. A discussed or carried one is refused (409): resolve it with annotation-update.',
    method: 'DELETE',
    path: '/api/documents/[id]/annotations/[annotationId]',
    params: annotationParams,
    destructive: true,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/route'),
  },
  {
    name: 'annotation-reply-create',
    domain: 'review',
    summary: 'Reply in an annotation’s thread',
    description:
      'Replies in an annotation’s thread; `addressesPiloti` or a mention of ' + PRODUCT_NAME + ' asks it to answer. Returns the annotation with its thread.',
    method: 'POST',
    path: '/api/documents/[id]/annotations/[annotationId]/replies',
    params: annotationParams,
    body: createReplyRequestSchema,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/replies/route'),
  },
  {
    name: 'annotation-reply-update',
    domain: 'review',
    summary: 'Reword one of your own replies',
    description:
      'Rewords one’s own reply while the annotation is live and ' + PRODUCT_NAME + ' has not taken it up (else 409). Returns the annotation with its thread.',
    method: 'PATCH',
    path: '/api/documents/[id]/annotations/[annotationId]/replies/[replyId]',
    params: replyParams,
    body: updateReplyRequestSchema,
    idempotent: true,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/replies/[replyId]/route'),
  },
  {
    name: 'annotation-reply-delete',
    domain: 'review',
    summary: 'Take back one of your own replies',
    description:
      'Deletes one’s own reply while the annotation is live and ' + PRODUCT_NAME + ' has not taken it up (else 409), permanently.',
    method: 'DELETE',
    path: '/api/documents/[id]/annotations/[annotationId]/replies/[replyId]',
    params: replyParams,
    destructive: true,
    load: () => import('@/app/api/documents/[id]/annotations/[annotationId]/replies/[replyId]/route'),
  },
  {
    name: 'document-thread-ensure',
    domain: 'review',
    summary: 'Open the caller’s conversation about a document',
    description:
      'The id of the caller’s own conversation about this document, created (optional `title`) the first time. Use it with the conversation operations.',
    method: 'POST',
    path: '/api/documents/[id]/thread',
    params: documentParams,
    body: documentThreadRequestSchema,
    idempotent: true,
    load: () => import('@/app/api/documents/[id]/thread/route'),
  },

  // ---- Calibrations: the scale a person set for a region of a drawing's page ----
  {
    name: 'drawing-calibration-list',
    feature: FEATURE_FLAGS.drawingMeasure,
    domain: 'review',
    summary: 'List the calibrations of a PDF drawing',
    description:
      'The calibrations people set on the document’s current version, oldest first: each a region of a page, two reference points and the ' +
      'true length between them in metres, places as shares of the page (origin top left). `status` defaults to `active`; ' +
      '`canCalibrate` says whether the caller may set one. Paged by `cursor`. A new version starts with none.',
    method: 'GET',
    path: '/api/documents/[id]/calibrations',
    params: documentParams,
    query: listCalibrationsQuerySchema,
    load: () => import('@/app/api/documents/[id]/calibrations/route'),
  },
  {
    name: 'drawing-calibration-set',
    feature: FEATURE_FLAGS.drawingMeasure,
    domain: 'review',
    summary: 'Set the scale of a region of a PDF drawing',
    description:
      'Calibrates a region of a page of the document’s current version from two reference points and the true length between them, ' +
      'superseding the region’s earlier calibration. Both points lie inside `region`, which is never the whole page by default. ' +
      'A file that is not a PDF is refused (422), a document with no version too (409). Returns the calibration.',
    method: 'POST',
    path: '/api/documents/[id]/calibrations',
    params: documentParams,
    body: setCalibrationRequestSchema,
    examples: [
      {
        params: { id: '5b1e7c2a-9d4f-4c3b-8a6e-2f1d0c9b8a7e' },
        // A dimension line of 5.40 m inside the floor plan that fills the left half of page 1.
        body: {
          page: 1,
          region: { x: 0.05, y: 0.08, w: 0.45, h: 0.8 },
          from: { x: 0.12, y: 0.62 },
          to: { x: 0.31, y: 0.62 },
          lengthM: 5.4,
        },
      },
    ],
    load: () => import('@/app/api/documents/[id]/calibrations/route'),
  },
  {
    name: 'drawing-calibration-withdraw',
    feature: FEATURE_FLAGS.drawingMeasure,
    domain: 'review',
    summary: 'Withdraw a calibration of a PDF drawing',
    description:
      'Withdraws one active calibration (id from drawing-calibration-list); its region is uncalibrated again, and the calibration it ' +
      'had superseded is not brought back. One that is not active is refused (409).',
    method: 'POST',
    path: '/api/documents/[id]/calibrations/[calibrationId]/withdraw',
    params: calibrationParams,
    load: () => import('@/app/api/documents/[id]/calibrations/[calibrationId]/withdraw/route'),
  },

  // ---- Quarantine: an upload held back by screening ----
  {
    name: 'document-quarantine-get',
    domain: 'review',
    summary: 'Read why a document is held and who may allow it',
    description:
      'For a document held back by upload screening: the reason and what the caller may do (ask for it to be allowed, or allow it as a reviewer). ' +
      'The uploader’s next call is document-quarantine-allow-request; allowing it is a reviewer’s own decision.',
    method: 'GET',
    path: '/api/documents/[id]/quarantine',
    params: documentParams,
    load: () => import('@/app/api/documents/[id]/quarantine/route'),
  },
  {
    name: 'document-quarantine-allow-request',
    domain: 'review',
    summary: 'Ask a reviewer to allow a held upload',
    description:
      'The uploader asks the project’s reviewers to allow their held file through; notifies them, changes nothing else. No body.',
    method: 'POST',
    path: '/api/documents/[id]/quarantine/request-release',
    params: documentParams,
    idempotent: true,
    load: () => import('@/app/api/documents/[id]/quarantine/request-release/route'),
  },
  {
    name: 'document-quarantine-allow',
    domain: 'review',
    summary: 'Allow a held document through screening',
    description:
      'A reviewer allows a held file through screening so it reads like any other document. Needs the reviewer permission ' +
      '(see document-quarantine-get). No body; the decision cannot be taken back.',
    method: 'POST',
    path: '/api/documents/[id]/quarantine/release',
    params: documentParams,
    destructive: true,
    sensitivity: 'control',
    load: () => import('@/app/api/documents/[id]/quarantine/release/route'),
  },
  {
    name: 'quarantine-decide',
    domain: 'review',
    summary: 'Allow, delete or recheck several held documents at once',
    description:
      'A reviewer decides about up to 50 held documents from quarantine-list in one call: `allow` reads each like any other ' +
      'upload, `delete` removes each for good, `recheck` screens each again with the rules in force now (a match holds it ' +
      'again). Every document is checked on its own; the answer is `results`, one `{ id, outcome }` per document, ' +
      'the outcome one of allowed, rechecking, deleted, changed (someone decided first), not_found, forbidden or failed ' +
      '(`changed` when someone decided first). The decision cannot be taken back.',
    method: 'POST',
    path: '/api/quarantine/decisions',
    body: quarantineDecisionsSchema,
    destructive: true,
    sensitivity: 'control',
    examples: [{ body: { decision: 'allow', documentIds: ['doc_1', 'doc_2'] } }],
    load: () => import('@/app/api/quarantine/decisions/route'),
  },

  // ---- Revisions: how one document replaces another ----
  {
    name: 'document-revision-compare',
    domain: 'review',
    summary: 'Compare a document visually with the one it replaces',
    description:
      'Marks what changed on one page between the older document (`older`, an id) and this one: boxed regions plus short sentences. ' +
      'Both must be readable and screened. Candidates: document-revision-candidates.',
    method: 'POST',
    path: '/api/documents/[id]/revision-compare',
    params: documentParams,
    body: revisionCompareBodySchema,
    readOnly: true,
    load: () => import('@/app/api/documents/[id]/revision-compare/route'),
  },
  {
    name: 'document-revision-link-set',
    domain: 'review',
    summary: 'Confirm or take back a revision link',
    description:
      'States that this document replaces `older` (`linked: true`) or takes that link back (`linked: false`). ' +
      'Both documents must be in the same collection and the caller needs write access.',
    method: 'PUT',
    path: '/api/documents/[id]/revision',
    params: documentParams,
    body: revisionLinkSchema,
    load: () => import('@/app/api/documents/[id]/revision/route'),
  },
  {
    name: 'document-revision-candidates',
    domain: 'review',
    summary: 'Find documents a new file could replace',
    description:
      'For file names about to be added to a project (`projectId`, `names`, optional target `folders`) or the office shelf ' +
      '(`scope: office_shelf`), lists existing documents each could be a new revision of. Read-only; feeds document-revision-link-set.',
    method: 'POST',
    path: '/api/documents/revision-candidates',
    body: revisionCandidatesRequestSchema,
    readOnly: true,
    load: () => import('@/app/api/documents/revision-candidates/route'),
  },
  {
    name: 'document-annotations-export',
    domain: 'review',
    summary: 'Export a document’s annotations as a minutes file',
    description:
      'The document’s annotations as one file: PDF (default), Word (docx) or Markdown (md), open or all, current revision or ' +
      'every one. An attached resource up to 5 MiB; Markdown comes back as text. For the data use annotation-list.',
    method: 'GET',
    path: '/api/documents/[id]/annotations/export',
    params: documentParams,
    // The route's schema transforms (`includeProposals` becomes a boolean); the agent sends the URL's own values.
    query: z.object({
      format: z.enum(ANNOTATION_EXPORT_FORMATS).optional().describe('pdf (default), docx or md.'),
      scope: z.enum(ANNOTATION_EXPORT_SCOPES).optional().describe('open (default): what still asks something; all: closed ones too.'),
      revision: z.enum(ANNOTATION_EXPORT_REVISIONS).optional().describe('current (default), or all to include earlier revisions’ closed annotations.'),
      includeProposals: z.enum(['0', '1']).optional().describe('1 adds ' + PRODUCT_NAME + '’s untaken proposals under a heading of their own.'),
    }),
    binaryResponse: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    load: () => import('@/app/api/documents/[id]/annotations/export/route'),
  },
  {
    name: 'project-annotations-export',
    domain: 'review',
    summary: 'Export a project’s open items as a minutes file',
    description:
      'The project’s open items as minutes: PDF (default), Word (docx) or Markdown (md), filtered like project-annotation-list. ' +
      'An attached resource up to 5 MiB; Markdown comes back as text. Refused above 1000 matches: narrow the filters.',
    method: 'GET',
    path: '/api/projects/[id]/annotations/export',
    params: projectParams,
    query: projectProtocolQuerySchema,
    binaryResponse: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    load: () => import('@/app/api/projects/[id]/annotations/export/route'),
  },

] as const satisfies readonly AgentOperation[]

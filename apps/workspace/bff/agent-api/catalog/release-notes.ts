/**
 * What changed in the product: the release notes members read under What’s new, and the
 * person's own record for the weekly summary notice (ADR-0156 and its amendment). In the
 * organization domain, beside the office's other reads; a file of its own so that one stays
 * under the size limit. See `projects.ts` for the shape.
 */

import {
  releaseNoteListQuerySchema,
  releaseNoticePreferenceBodySchema,
  releaseSummarySeenBodySchema,
} from '@/lib/release-notes/release-notes-wire'
import type { AgentOperation } from '../operation'

export const releaseNotesOperations = [
  {
    name: 'release-note-list',
    domain: 'organization',
    summary: 'List what changed in the product, week by week',
    description:
      'The release notes members read under What’s new: every change to the product, newest week first, each with ' +
      'its section (features, improvements, fixes, deprecations, upgrade, other), its product area and its text in ' +
      'English and German, plus the week’s summary once written. Page by weeks with `limit` and `nextCursor`; narrow ' +
      'to one area with `area`, and `areas` in the answer counts the changes per area. The same for every ' +
      'organization. Use it to answer whether the product can do something now, or what changed since a date.',
    method: 'GET',
    path: '/api/release-notes',
    query: releaseNoteListQuerySchema,
    load: () => import('@/app/api/release-notes/route'),
  },
  {
    name: 'release-summary-unseen-get',
    domain: 'organization',
    summary: 'Read the newest weekly summary the person has not seen',
    description:
      'The newest week’s release-notes summary, in English and German, when the person has not seen it yet; ' +
      '`{ summary: null }` once they have, or when the newest week has no summary. What the app’s notice shows. ' +
      'To read the summaries themselves, use release-note-list.',
    method: 'GET',
    path: '/api/release-notes/unseen-summary',
    load: () => import('@/app/api/release-notes/unseen-summary/route'),
  },
  {
    name: 'release-summary-seen-mark',
    domain: 'organization',
    summary: 'Record that the person has seen a weekly summary',
    description:
      'Records `week` (from release-summary-unseen-get) as seen, so the app’s notice does not show it again on any ' +
      'device; `stop: true` also turns the notice off, as release-summary-notice-set does. Never moves back to an ' +
      'older week; a week without a published summary is refused.',
    method: 'POST',
    path: '/api/release-notes/seen',
    body: releaseSummarySeenBodySchema,
    idempotent: true,
    load: () => import('@/app/api/release-notes/seen/route'),
  },
  {
    name: 'release-summary-notice-get',
    domain: 'organization',
    summary: 'Read whether the person wants the weekly summary notice',
    description: 'Whether the app shows the person the newest weekly summary once, in a notice, as `{ enabled }`.',
    method: 'GET',
    path: '/api/release-notes/notice-preference',
    load: () => import('@/app/api/release-notes/notice-preference/route'),
  },
  {
    name: 'release-summary-notice-set',
    domain: 'organization',
    summary: 'Turn the weekly summary notice on or off for the person',
    description:
      'Sets `enabled`. Turning it back on records the newest summary as seen, so the notice resumes with the next ' +
      'week published. Returns `{ enabled }`.',
    method: 'PUT',
    path: '/api/release-notes/notice-preference',
    body: releaseNoticePreferenceBodySchema,
    load: () => import('@/app/api/release-notes/notice-preference/route'),
  },
] as const satisfies readonly AgentOperation[]

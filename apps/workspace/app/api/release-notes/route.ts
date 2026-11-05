/**
 * What changed in the product: the customer tier of the release notes, a page of weeks at a time,
 * optionally narrowed to one product area (ADR-0156). The same for every office.
 *
 * GET — any signed-in member. The notes are product news, the same for every organization, and
 *       carry no tenant data; they are behind sign-in only because the public tier is the weekly
 *       summary alone.
 */

import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listReleaseNotes } from '@/lib/release-notes/release-notes'
import { releaseNoteListQuerySchema } from '@/lib/release-notes/release-notes-wire'

export const GET = apiRoute(
  async ({ request }) => listReleaseNotes(parseQuery(request, releaseNoteListQuerySchema)),
  {
    authz: {
      sessionOnly: true,
      why: 'the release notes are product news, identical for every organization and free of tenant data; the session only keeps the per-note detail off the public web, where the weekly summary is the whole story',
    },
  }
)

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

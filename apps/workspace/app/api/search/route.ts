import { NextResponse } from 'next/server'

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { searchForAgent } from '@/lib/base-knowledge/door-guard'
import { runTimedSearch, serverTimingHeader } from '@/lib/search/document-search'
import { searchBodySchema, searchScopeQuerySchema } from '@/lib/search/search-wire'

export const POST = apiRoute(
  async ({ session, request }) => {
    const scope = parseQuery(request, searchScopeQuerySchema)
    const body = await parseJsonBody(request, searchBodySchema)
    const { response, timing } = await runTimedSearch(session, scope, body)
    return NextResponse.json(await searchForAgent(session, response), { headers: { 'Server-Timing': serverTimingHeader(timing) } })
  },
  {
    authz: {
      enforcedBy:
        'runTimedSearch -> reachFor: listProjects (project:view per project) or requireProjectAccess project:view, getProjectFolderAccess (hidden and restricted folders), shelfReaderFor (held uploads); the office shelf is any member',
    },
  }
)

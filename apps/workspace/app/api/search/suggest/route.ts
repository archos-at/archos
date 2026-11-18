import { NextResponse } from 'next/server'

import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { searchScopeQuerySchema, suggestBodySchema } from '@/lib/search/search-wire'
import { runSuggest } from '@/lib/search/suggest'

export const POST = apiRoute(
  async ({ session, request }) => {
    const started = performance.now()
    const scope = parseQuery(request, searchScopeQuerySchema)
    const body = await parseJsonBody(request, suggestBodySchema)
    const response = await runSuggest(session, scope, body)
    const ms = Math.round((performance.now() - started) * 10) / 10
    return NextResponse.json(response, { headers: { 'Server-Timing': `sql;dur=${ms}` } })
  },
  {
    authz: {
      enforcedBy:
        'runSuggest -> reachFor: listProjects (project:view per project) or requireProjectAccess project:view, getProjectFolderAccess (hidden and restricted folders), shelfReaderFor (held uploads); the office shelf is any member',
    },
  }
)

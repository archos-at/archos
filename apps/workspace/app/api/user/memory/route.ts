import { NextResponse } from 'next/server'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { offsetPageOf } from '@/lib/api/offset-page'
import {
  clearPersonalMemory,
  createPersonalMemoryItem,
  listPersonalMemory,
  listPersonalMemoryTopics,
  personalListFilter,
} from '@/lib/personal-memory/service'
import { createPersonalMemorySchema, listPersonalMemoryQuerySchema } from '@/lib/personal-memory/wire'

const WHY = 'the caller’s own notes, keyed to session.userId and held by row-level security on the person'

export const GET = apiRoute(
  async ({ session, request }) => {
    const query = parseQuery(request, listPersonalMemoryQuerySchema)
    const owner = { organizationId: session.organizationId, userId: session.userId }
    const [page, topics] = await Promise.all([
      listPersonalMemory(owner, offsetPageOf(query), await personalListFilter(owner, query)),
      listPersonalMemoryTopics(owner),
    ])
    return { ...page, topics }
  },
  { authz: { sessionOnly: true, why: WHY } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createPersonalMemorySchema)
    const { item, created } = await createPersonalMemoryItem(
      { organizationId: session.organizationId, userId: session.userId },
      { ...input, provenanceType: 'user' }
    )
    return NextResponse.json({ item, created }, { status: created ? 201 : 200 })
  },
  { authz: { sessionOnly: true, why: WHY } }
)

export const DELETE = apiRoute(
  async ({ session }) => {
    const removed = await clearPersonalMemory({ organizationId: session.organizationId, userId: session.userId })
    return { removed }
  },
  { authz: { sessionOnly: true, why: WHY } }
)

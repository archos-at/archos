import { NextResponse } from 'next/server'
import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { resolveActiveCredentialForBackend } from '@/lib/llm-credentials/service'

const querySchema = z.object({
  organizationId: z.string().regex(/^org_[A-Za-z0-9]+$/, 'not a WorkOS organization id'),
})

export const GET = internalApiRoute(
  'llm-credential',
  async ({ request }) => {
    const { organizationId } = parseQuery(request, querySchema)
    const credential = await withTenant({ organizationId }, () =>
      resolveActiveCredentialForBackend(organizationId)
    )
    return NextResponse.json(
      { credential },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  },
  { tenancy: { fromPayload: '?organizationId' } }
)

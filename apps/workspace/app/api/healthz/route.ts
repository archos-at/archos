import { NextResponse } from 'next/server'
import { publicApiRoute } from '@/lib/api/handler'
import { deployedSha } from '@/lib/boot'

export const dynamic = 'force-dynamic'

export const GET = publicApiRoute(
  async () =>
    NextResponse.json(
      { status: 'ok', sha: deployedSha() },
      { headers: { 'Cache-Control': 'no-store' } }
    ),
  { why: 'a dependency-free liveness probe: it reads nothing and returns a constant' }
)

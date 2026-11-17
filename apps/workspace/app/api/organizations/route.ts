import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { refreshSession } from '@workos-inc/authkit-nextjs'
import { z } from 'zod'
import { captureServer } from '@/lib/analytics/posthog-server'
import { publicApiRoute } from '@/lib/api/handler'
import { BadRequestError, UnauthorizedError } from '@/lib/api/errors'
import { getWorkOS } from '@/lib/workos/client'
import { recordAuditEvent } from '@/lib/audit/service'
import { HOME_COUNTRIES, homeCountrySchema } from '@/lib/organizations/home-country'
import { placeOrganization } from '@/lib/organizations/repository'

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  homeCountry: homeCountrySchema,
})

function creationKey(userId: string, name: string): string {
  return `organization-create:${createHash('sha256').update(`${userId}\n${name}`).digest('hex')}`
}

export const GET = publicApiRoute(
  async () => ({
    selfServeDisabled: (process.env.DISABLE_SELF_SERVE_ORGS ?? '').toLowerCase() === 'true',
  }),
  { why: 'mirrors one deployment flag the onboarding UI needs before a session exists' }
)

export const POST = publicApiRoute(
  async ({ request }) => {
    const body = await request.json().catch(() => null)
    const parsed = createOrganizationSchema.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestError(
        'Organization name (1-100 characters) and home country (one of ' + HOME_COUNTRIES.join(', ') + ') are required.'
      )
    }

    const { name, homeCountry } = parsed.data

    let session
    try {
      session = await refreshSession({ ensureSignedIn: true })
    } catch {
      throw new UnauthorizedError()
    }

    if (!session.user) {
      throw new UnauthorizedError()
    }

    if ((process.env.DISABLE_SELF_SERVE_ORGS ?? '').toLowerCase() === 'true') {
      return NextResponse.json({ error: 'self-serve-disabled' }, { status: 403 })
    }

    const workos = getWorkOS()

    try {
      const organization = await workos.organizations.createOrganization(
        { name },
        { idempotencyKey: creationKey(session.user.id, name) }
      )
      const existing = await workos.userManagement.listOrganizationMemberships({
        userId: session.user.id,
        organizationId: organization.id,
      })
      if (existing.data.length === 0) {
        await workos.userManagement.createOrganizationMembership({
          userId: session.user.id,
          organizationId: organization.id,
          roleSlug: 'admin',
        })
      }

      await placeOrganization(organization.id, homeCountry)

      await refreshSession({ organizationId: organization.id, ensureSignedIn: true })

      await recordAuditEvent({
        organizationId: organization.id,
        actor: { userId: session.user.id, email: session.user.email },
        action: 'org.created',
        targetType: 'organization',
        targetId: organization.id,
        metadata: { name, homeCountry },
        request,
      })
      captureServer({
        event: 'organization_created',
        distinctId: session.user.id,
        organizationId: organization.id,
      })
      return { organizationId: organization.id }
    } catch (error) {
      console.error('[Organizations] Failed to create organization:', error)
      return NextResponse.json({ error: 'create-failed' }, { status: 500 })
    }
  },
  {
    why: 'brand-new users have no organization yet, so requireAuthorizedSession would reject exactly the callers this endpoint exists for; it authenticates via refreshSession({ ensureSignedIn: true }) instead',
  }
)

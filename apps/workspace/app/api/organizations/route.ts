/**
 * Organization creation API
 *
 * Creates a new WorkOS organization for the authenticated user, makes the user
 * an admin member, then refreshes the AuthKit session so the access token
 * contains the new org_id claim.
 *
 * Declared through `publicApiRoute` because neither handler can use the
 * standard session guard: GET is an intentionally public deployment-policy
 * probe, and POST authenticates via `refreshSession` — brand-new users have
 * no organization yet, so `requireAuthorizedSession` would reject exactly
 * the callers this endpoint exists for.
 */

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
  /** The office's own seat (migration 0200). Never the law of its projects' sites. */
  homeCountry: homeCountrySchema,
})

/**
 * The WorkOS idempotency key of one person creating one organization name. A
 * double submit or a retry within WorkOS's window returns the organization the
 * first call made; another name, or another person, is another organization.
 */
function creationKey(userId: string, name: string): string {
  return `organization-create:${createHash('sha256').update(`${userId}\n${name}`).digest('hex')}`
}

/**
 * Sign-up policy for the onboarding UI: whether self-service organization
 * creation is enabled. Safe to expose — it only mirrors a deployment flag.
 */
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

    // Enterprise control (ADR-0016): deployments can turn self-service org
    // creation off, so workspaces only come from the platform owner or via
    // invitations. Fresh users then see guidance instead of an org form.
    // Stable error code consumed by the onboarding UI — shape kept as-is.
    if ((process.env.DISABLE_SELF_SERVE_ORGS ?? '').toLowerCase() === 'true') {
      return NextResponse.json({ error: 'self-serve-disabled' }, { status: 403 })
    }

    const workos = getWorkOS()

    try {
      // Idempotent: a retry after a failed later step (the membership, the row)
      // gets the same organization back from WorkOS, never a second one, and
      // the membership is made only if it is missing.
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

      // The row and its home country exist from the start: every organization is placed (design 5.1).
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
      // The server is the truth for this event (ADR-0100): the browser's copy
      // fired only if the response arrived and the tab survived to read it.
      // Fire-and-forget; no name, nothing but the ids.
      captureServer({
        event: 'organization_created',
        distinctId: session.user.id,
        organizationId: organization.id,
      })
      return { organizationId: organization.id }
    } catch (error) {
      // Log the full error server-side; never leak provider internals to the
      // client (raw WorkOS messages can reference internal configuration).
      // Stable error code consumed by the onboarding UI — shape kept as-is.
      console.error('[Organizations] Failed to create organization:', error)
      return NextResponse.json({ error: 'create-failed' }, { status: 500 })
    }
  },
  {
    why: 'brand-new users have no organization yet, so requireAuthorizedSession would reject exactly the callers this endpoint exists for; it authenticates via refreshSession({ ensureSignedIn: true }) instead',
  }
)

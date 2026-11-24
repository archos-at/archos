import { notFound, redirect } from 'next/navigation'
import { NoOrganizationError, NotFoundError } from '@/lib/api/errors'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { requireUserSession } from './session'
import type { AuthorizedSession } from './types'

export async function requireAuthorizedSession(): Promise<AuthorizedSession> {
  const session = await requireUserSession()

  if (!session.organizationId) {
    throw new NoOrganizationError()
  }

  return session as AuthorizedSession
}

export async function requireAuthorizedPageSession(): Promise<AuthorizedSession> {
  try {
    return await requireAuthorizedSession()
  } catch (error) {
    if (error instanceof NoOrganizationError) {
      redirect('/app/onboarding/organization')
    }
    throw error
  }
}

export function withPageSession<T>(fn: (session: AuthorizedSession) => Promise<T> | T): Promise<T> {
  return runWithTenantSlot(async () => {
    const session = await requireAuthorizedPageSession()
    try {
      return await fn(session)
    } catch (error) {
      if (error instanceof NotFoundError) notFound()
      throw error
    }
  })
}

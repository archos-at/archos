export interface UserSession {
  userId: string

  email: string

  name: string | null

  accessToken: string

  organizationId: string | null

  organizationMembershipId: string | null

  role: string | null

  roles?: string[]

  permissions: string[]

  featureFlags: string[] | null

  profilePictureUrl?: string | null

  organizationName?: string | null
}

export interface AuthorizedSession extends UserSession {
  organizationId: string
  organizationMembershipId: string
  role: string
  permissions: string[]
}

export function rolesOf(session: Pick<UserSession, 'role' | 'roles'>): string[] {
  if (session.roles && session.roles.length > 0) return session.roles
  return session.role ? [session.role] : []
}

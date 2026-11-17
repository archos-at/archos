import 'server-only'
import { getCached } from '@/lib/cache'
import { getWorkOS } from '@/lib/workos/client'

export interface DirectoryPerson {
  userId: string
  email: string | null
  name: string
  profilePictureUrl: string | null
}

const DIRECTORY_TTL_MS = 5 * 60 * 1000

function displayName(user: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return full || user.email || 'Unknown'
}

export async function loadOrganizationDirectory(
  organizationId: string,
): Promise<Map<string, DirectoryPerson>> {
  try {
    return await loadOrganizationDirectoryStrict(organizationId)
  } catch (error) {
    console.warn(`[directory] failed to load organization ${organizationId}:`, error)
    return new Map()
  }
}

export async function loadOrganizationDirectoryStrict(
  organizationId: string,
): Promise<Map<string, DirectoryPerson>> {
  const people = await getCached(`directory:${organizationId}`, DIRECTORY_TTL_MS, async () => {
    const workos = getWorkOS()
    const users = await workos.userManagement
      .listUsers({ organizationId })
      .then((page) => page.autoPagination())
    return users.map((user) => ({
      userId: user.id,
      email: user.email ?? null,
      name: displayName(user),
      profilePictureUrl: user.profilePictureUrl ?? null,
    })) satisfies DirectoryPerson[]
  })
  return new Map(people.map((person) => [person.userId, person]))
}

export async function resolvePeople(
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, DirectoryPerson>> {
  if (userIds.length === 0) return new Map()
  const directory = await loadOrganizationDirectory(organizationId)
  const wanted = new Set(userIds)
  return new Map([...directory].filter(([userId]) => wanted.has(userId)))
}

export function unknownPerson(userId: string): DirectoryPerson {
  return { userId, email: null, name: userId, profilePictureUrl: null }
}

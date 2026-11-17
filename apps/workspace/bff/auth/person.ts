import 'server-only'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'

export interface Person {
  name: string | null
  email: string | null
  organizationName: string | null
}

export async function resolvePerson(organizationId: string, userId: string): Promise<Person> {
  const [directory, organizationName] = await Promise.all([
    loadOrganizationDirectory(organizationId),
    getOrganizationDisplayName(organizationId),
  ])
  const person = directory.get(userId)
  const name = person && person.name !== person.email && person.name !== 'Unknown' ? person.name : null
  return { name, email: person?.email ?? null, organizationName }
}

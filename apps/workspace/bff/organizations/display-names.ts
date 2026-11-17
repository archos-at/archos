import 'server-only'
import { getOrganizationDisplayName } from './service'

const BATCH_SIZE = 10

export async function getOrganizationDisplayNames(
  ids: Iterable<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  for (let index = 0; index < unique.length; index += BATCH_SIZE) {
    const batch = unique.slice(index, index + BATCH_SIZE)
    const resolved = await Promise.all(
      batch.map((id) => getOrganizationDisplayName(id).catch(() => null))
    )
    batch.forEach((id, position) => {
      const name = resolved[position]
      if (name) names.set(id, name)
    })
  }
  return names
}

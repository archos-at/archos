import { WorkOS } from '@workos-inc/node'

let workos: WorkOS | null = null

export function getWorkOS(): WorkOS {
  if (workos) {
    return workos
  }

  const apiKey = process.env.WORKOS_API_KEY

  if (!apiKey) {
    throw new Error('WORKOS_API_KEY is required')
  }

  workos = new WorkOS(apiKey, { timeout: 30_000 })

  return workos
}

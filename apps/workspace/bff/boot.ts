export type FlagSource = 'workos' | 'defaults'

export interface BootFacts {
  sha: string
  flags: FlagSource
}

export const UNKNOWN_SHA = 'unknown'

export function deployedSha(env: NodeJS.ProcessEnv = process.env): string {
  const sha = (env.GIT_SHA ?? '').trim()
  return sha === '' ? UNKNOWN_SHA : sha
}

export function flagSource(env: NodeJS.ProcessEnv = process.env): FlagSource {
  return (env.REQUIRE_AUTH ?? '').toLowerCase() === 'true' ? 'workos' : 'defaults'
}

export function formatBootLine(facts: BootFacts): string {
  return `[boot] sha=${facts.sha} flags=${facts.flags}`
}

export function bootLine(env: NodeJS.ProcessEnv = process.env): string {
  return formatBootLine({ sha: deployedSha(env), flags: flagSource(env) })
}

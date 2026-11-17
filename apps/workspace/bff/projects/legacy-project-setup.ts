// drop after release 2026-W48
export const LEGACY_AGENT_SETUP = 'piloti'

export const isLegacyAgentSetup = (setup: string | undefined): boolean => setup === LEGACY_AGENT_SETUP

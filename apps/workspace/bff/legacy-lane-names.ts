// drop after release 2026-W48
import { AGENT_AUTHORED_LANE } from './source-kinds'

export const LEGACY_AGENT_AUTHORED_LANE = 'office_piloti'

export const isAgentLane = (value: string | null | undefined): boolean =>
  value === AGENT_AUTHORED_LANE || value === LEGACY_AGENT_AUTHORED_LANE

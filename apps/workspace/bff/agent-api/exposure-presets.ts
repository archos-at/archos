/**
 * The shared entries of `exposure.config.ts`: who sees an operation, said once
 * for every operation it holds for. Split from the config so the one file that
 * decides exposure stays a readable table.
 */

import type { Exposure } from './exposure.config'

/** Offered to an outside agent and to the agent. */
export const OFFERED = { external: true, piloti: true } as const satisfies Exposure

/** The operator console: the platform door only (ADR-0126). */
export const PLATFORM = {
  external: false,
  piloti: false,
  platform: true,
  reason: 'the operator console is the platform operator’s, not an office’s: every write there reaches every tenant',
} as const satisfies Exposure

export const SENSITIVE = {
  external: true,
  piloti: false,
  reason:
    'its `sensitivity` widens access, touches a secret or turns a control down: an outside agent sees it only under ' +
    'the organization’s opt-in and the step-up scope, and accepting a card the agent worded is not the confirmation it needs',
} as const satisfies Exposure

export const DECISION = {
  external: true,
  piloti: false,
  reason: 'the person decides a proposal, or undoes a change, on its own card; the agent never decides it for them',
} as const satisfies Exposure

export const ASK = {
  external: true,
  piloti: false,
  reason: 'how another agent consults the workspace’s agent; the agent never asks itself (ADR-0124, the recursion lock)',
} as const satisfies Exposure

/**
 * The Outlook import's byte protocol (start, part upload, complete). The agent has
 * no archive to send, and a part is 32 MiB, far past what a proposal may carry
 * (`MAX_PROPOSED_INPUT_CHARS`), so offering it costs the agent a tool slot and a
 * proposal that is always refused. Watching and cancelling an import stay offered.
 */
export const ARCHIVE_BYTES = {
  external: true,
  piloti: false,
  reason:
    'The agent holds no Outlook archive: the bytes come from the person’s disk, and a part is larger than any proposal a person can read',
} as const satisfies Exposure

/** A control on an MCP Apps card (ADR-0142): the person presses it, the model never sees it, the agent never decides. */
export const APP_ONLY = {
  external: false,
  piloti: false,
  app: true,
  reason:
    'pressed by the person on the agent’s card inside their own assistant (an MCP App); listed with `visibility: ["app"]`, so ' +
    'the host keeps it from the model, and it runs the catalog operation it names through that operation’s route',
} as const satisfies Exposure

export const NATIVE_READ = 'The agent reads with this native tool itself; the door offers it to outside agents'
export const MEMORY =
  'The agent keeps a note with its own `remember`, which records where the finding came from and keeps a restricted one in its project'
export const TASK = 'The agent proposes a task, or commissions a run, with its own `create_task`, whose card the person confirms'
export const SKILL_READ =
  'The agent is given the office’s skills at turn start and reads one with its own `read_file`, which the turn records; the door offers them to outside agents'
export const CANVAS = 'The agent marks a document, and answers in a mark’s thread, with its own canvas tools, anchored where it looked'

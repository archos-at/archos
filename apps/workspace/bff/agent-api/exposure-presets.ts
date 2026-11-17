import type { Exposure, WithheldCategory } from './exposure.config'

export const externalOnly = (reason: string) => ({ external: true, agent: false, reason }) as const satisfies Exposure

export const withheldAs = (category: WithheldCategory, reason: string) =>
  ({ external: false, agent: false, withheld: { category, reason } }) as const satisfies Exposure

export const OFFERED = { external: true, agent: true } as const satisfies Exposure

export const SENSITIVE = externalOnly(
  'its `sensitivity` widens access, touches a secret or turns a control down: an outside agent sees it only under ' +
    'the organization’s opt-in and the step-up scope, and accepting a card the agent worded is not the confirmation it needs',
)

export const DECISION = externalOnly(
  'the person decides a proposal, or undoes a change, on its own card; the agent never decides it for them',
)

export const ASK = externalOnly(
  'how another agent consults the workspace’s agent; the agent never asks itself (ADR-0124, the recursion lock)',
)

export const ARCHIVE_BYTES = externalOnly(
  'The agent holds no Outlook archive: the bytes come from the person’s disk, and a part is larger than any proposal a person can read',
)

export const HELD_MAIL =
  'held mail is unconfirmed third-party content nobody has filed yet; the agent reads it once a person filed it into the project'

export const APP_ONLY = {
  external: false,
  agent: false,
  app: true,
  reason:
    'pressed by the person on the agent’s card inside their own assistant (an MCP App); listed with `visibility: ["app"]`, so ' +
    'the host keeps it from the model, and it runs the catalog operation it names through that operation’s route',
} as const satisfies Exposure

export const NATIVE_READ = 'The agent reads with this native tool itself; the door offers it to outside agents'
export const MEMORY =
  'The agent keeps a note with its own `remember`, which records where the finding came from and keeps a restricted one in its project'
export const PERSONAL_MEMORY =
  'The agent keeps a note about the person with its own `remember` (scope `personal`), which records the conversation it came from'
export const TASK = 'The agent proposes a task, or commissions a run, with its own `create_task`, whose card the person confirms'
export const SKILL_READ =
  'The agent is given the office’s skills at turn start and reads one with its own `read_file`, which the turn records; the door offers them to outside agents'
export const CANVAS = 'The agent marks a document, and answers in a mark’s thread, with its own canvas tools, anchored where it looked'

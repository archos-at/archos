import { z } from 'zod'
import { knowledgeContextSchema } from '@/lib/base-knowledge/context/wire'

export const turnContextRequestSchema = z.object({
  query: z.string().trim().max(2000).optional(),
}).strict()

export const turnContextResponseSchema = z.object({
  projectContext: z.string().nullable(),
  projectMemory: z.string().nullable(),
  orgInstructions: z.string().nullable(),
  /**
   * The conversation drew on another project that still restricts its readers
   * (an active one, ADR-0094): the turn starts with every door a whole project
   * reads shut, memory included, instead of learning it from a refusal. Content
   * from a closed project does not count.
   */
  drewOnOtherProjects: z.boolean(),
  /**
   * The office's reference projects, one line each: the closed projects most
   * like this one (`lib/cross-project/reference-brief.ts`), so the agent can
   * look there unasked. Null when the office has none.
   */
  referenceProjects: z.string().nullable(),
  /**
   * The WORKSPACE block (`workspace-block.ts`, ADR-0123): the asker's roles,
   * the project, the conversation's audience, the inbox and runs that wait,
   * and this conversation's proposals with every status. Null when it could
   * not be read; an older agent ignores it.
   */
  workspace: z.string().nullable(),
  /**
   * The office's confirmed base knowledge (`lib/base-knowledge/office/turn-block.ts`,
   * ADR-0163): one line per licensed standard, commentary, directive, guideline
   * or law it holds, with edition, role, the project's directive verdict and the
   * last check. Null when the office holds none; an older agent ignores it.
   */
  baseKnowledge: z.string().nullable(),
  /**
   * The data of the label an answer puts on a passage from each confirmed
   * office copy (`lib/base-knowledge/office/answer-label.ts`): kind,
   * designation, edition, role, last check, text use, a directive's verdict.
   * Tokens, no prose; the answer's renderer words it. Empty with the flag off.
   */
  baseKnowledgeLabels: z.array(z.record(z.string(), z.unknown())),
  /**
   * The turn's knowledge context (`lib/base-knowledge/context/`, ADR-0173):
   * the gate, the chain, each edition's role with its coverage qualifier and
   * freshness, the packs and their release sequence, and the countries the
   * turn may retrieve from, and the chain text (`text`, the `<building_law>`
   * block) in the same roles: one payload for the law, never a second one beside
   * it. On every turn (ADR-0175): a context that could not
   * be read is the gate's `knowledge_unavailable`, never absent, so the agent
   * fails closed.
   */
  knowledgeContext: knowledgeContextSchema,
}).strict()

export const turnContextApiResponseSchema = z.object({ data: turnContextResponseSchema }).strict()

export type TurnContextRequest = z.infer<typeof turnContextRequestSchema>
export type TurnContextResponse = z.infer<typeof turnContextResponseSchema>
export type TurnContextApiResponse = z.infer<typeof turnContextApiResponseSchema>

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
   * The asker's personal memory (`lib/personal-memory/service.ts`, ADR-0180):
   * what the agent keeps about this one person, bounded, under the header
   * `PERSONAL_MEMORY v1`. Read under row-level security on the person, so it is
   * never another member's. Delivered only where the asker alone reads the
   * answer: a turn without a conversation, or a conversation that is solo for
   * them (private, theirs, granted to nobody; one not created yet counts). In a
   * conversation others read it is null, and so it is when the audience could
   * not be read. Also null when the person holds no note or it could not be
   * read; an older agent ignores it.
   */
  personalMemory: z.string().nullable(),
  /**
   * The turn's conversation is temporary (`lib/conversations/temporary.ts`,
   * ADR-0180 rule 2): nothing from it is kept, so the agent skips its memory
   * writers (`remember`, the reflection stage). The memory routes refuse such a
   * write with `TEMPORARY_CONVERSATION` whatever the agent does. Reading is
   * untouched: `projectMemory` and `personalMemory` are delivered as on any
   * turn. False without a conversation, and for one whose row does not exist yet.
   */
  temporary: z.boolean(),
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
  /**
   * Which kinds of model file the project holds and the agent may read
   * (`lib/bim/model-kinds-repository.ts`), so the agent binds its IFC and DXF
   * tools only where there is one. Null outside a project or when it could not
   * be read: the agent then binds them as before. An older agent ignores it.
   */
  projectModels: z.object({ ifc: z.boolean(), dxf: z.boolean() }).strict().nullable(),
}).strict()

export const turnContextApiResponseSchema = z.object({ data: turnContextResponseSchema }).strict()

export type TurnContextRequest = z.infer<typeof turnContextRequestSchema>
export type TurnContextResponse = z.infer<typeof turnContextResponseSchema>
export type TurnContextApiResponse = z.infer<typeof turnContextApiResponseSchema>

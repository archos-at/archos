import { z } from 'zod'
import { CARD_DECISIONS } from '@/features/cards/card-decision'
import { CONVERSATION_ENGAGEMENTS } from '@/lib/db/schema/conversations'
import { MAX_MENTIONS_PER_MESSAGE, MAX_MESSAGES_PER_REQUEST } from '@/lib/limits'

export const createConversationSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().nullable().optional(),
  projectId: z.guid().nullable().optional(),
  subjectResourceType: z.literal('document').nullable().optional(),
  subjectResourceId: z.string().min(1).max(128).nullable().optional(),
  temporary: z
    .boolean()
    .optional()
    .describe('True starts a temporary conversation: nothing from it is kept in project, organization or personal memory.'),
})

export const CONVERSATION_PAGE_MAX = 200

export const listConversationsQuerySchema = z.object({
  projectId: z.guid().optional().describe('Only this project’s conversations.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CONVERSATION_PAGE_MAX)
    .default(50)
    .describe(`Page size (default 50, most ${CONVERSATION_PAGE_MAX}).`),
  cursor: z.string().min(1).max(128).optional().describe('The previous `nextCursor`.'),
})

export const MESSAGE_INCLUDES = ['citations', 'steps', 'metadata'] as const
export type MessageInclude = (typeof MESSAGE_INCLUDES)[number]

export const MESSAGE_PAGE_MAX = 200

export const listMessagesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MESSAGE_PAGE_MAX)
    .default(50)
    .describe(`Page size (default 50, most ${MESSAGE_PAGE_MAX}).`),
  cursor: z
    .string()
    .guid()
    .optional()
    .describe('The previous `nextCursor`: earlier messages.'),
  include: z
    .string()
    .max(64)
    .refine((value) => value.split(',').every((part) => (MESSAGE_INCLUDES as readonly string[]).includes(part.trim())), {
      message: `include is a comma-separated list of ${MESSAGE_INCLUDES.join(', ')}`,
    })
    .optional()
    .describe(
      'Comma-separated extras, none by default: `citations` (sources with snippets), `steps` (thinking steps), `metadata` (cards, provenance, the rest).',
    ),
})

export const updateConversationSchema = z
  .object({
    title: z.string().min(1).optional(),
    engagement: z.enum(CONVERSATION_ENGAGEMENTS).optional(),
    temporary: z
      .boolean()
      .optional()
      .describe(
        'True makes the conversation temporary: from now on nothing from it is kept in project, organization or personal memory. ' +
          'False keeps memory again from the next turn; nothing from the turns before is kept.',
      ),
  })
  .refine((body) => body.title !== undefined || body.engagement !== undefined || body.temporary !== undefined, {
    message: 'Provide title, engagement or temporary',
  })

export const generateTitleSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .max(20),
  locale: z.string().optional(),
})

export const markReadSchema = z.object({
  lastReadMessageId: z.string().min(1).max(128).nullable().optional(),
})

const mentionSchema = z.object({
  targetId: z.string().min(1).max(128),
})

const createMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  messageType: z.string().min(1).max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  mentions: z.array(mentionSchema).max(MAX_MENTIONS_PER_MESSAGE).optional(),
  mentionNote: z.string().max(500).nullable().optional(),
})

export const createMessagesSchema = z.union([
  createMessageSchema,
  z.array(createMessageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
])

const MAX_CARD_INTERACTIONS = 64

export const updateMessageSchema = z
  .object({
    cardInteractions: z
      .record(
        z.string().min(1).max(64),
        z.object({
          decision: z.enum(CARD_DECISIONS),
          decidedAt: z.string().datetime(),
        })
      )
      .refine((map) => Object.keys(map).length <= MAX_CARD_INTERACTIONS, {
        message: `At most ${MAX_CARD_INTERACTIONS} card interactions per message`,
      })
      .optional(),
    provenance: z.unknown().optional(),
    promptState: z.unknown().optional(),
    stages: z.unknown().optional(),
  })
  .refine(
    (body) =>
      body.cardInteractions !== undefined ||
      body.provenance !== undefined ||
      body.promptState !== undefined ||
      body.stages !== undefined,
    { message: 'Provide cardInteractions, provenance, promptState or stages' }
  )

const MAX_SHOWN_CHARS = 200_000

export const cutStoppedAnswerSchema = z.object({
  turnId: z.guid(),
  shown: z.string().max(MAX_SHOWN_CHARS),
})

export const fileDraftBodySchema = z
  .object({
    path: z.string().min(1).max(500),
    title: z.string().max(500).optional(),
    force: z.boolean().optional().default(false),
    folderId: z
      .guid()
      .nullable()
      .optional()
      .describe('The folder to file into, from project-folder-list; null files at the project root; omit for the default folder.'),
    name: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('The file name in the project; its extension is set to the draft’s own type. Omit to keep the title.'),
    as: z
      .enum(['own', 'revision'])
      .optional()
      .describe(
        'For a draft made from a project document: `revision` files it as that document’s next Fassung, `own` as a separate file. Omit for a separate file.',
      ),
    overChanges: z
      .boolean()
      .optional()
      .describe('Write the new Fassung over a Fassung a person changed since the draft was filed.'),
    changeNote: z
      .string()
      .max(500)
      .optional()
      .describe('The Änderungsvermerk of a new Fassung: what changed against the Fassung before it.'),
  })
  .strict()

export const draftPreviewQuerySchema = z.object({
  path: z.string().min(1).max(500),
  v: z.coerce.number().int().min(1).max(1_000_000).optional(),
})

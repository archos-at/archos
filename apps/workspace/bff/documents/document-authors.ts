export const DOCUMENT_AUTHORS = ['user', 'agent'] as const
export type DocumentAuthor = (typeof DOCUMENT_AUTHORS)[number]

export const AUTHORED_REF_KINDS = ['agent_run', 'answer_artifact'] as const
export type AuthoredRefKind = (typeof AUTHORED_REF_KINDS)[number]

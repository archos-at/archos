export const AGENT_FILE_TYPES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', kind: 'ooxml' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', kind: 'ooxml' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: 'pptx', kind: 'ooxml' },
  'application/pdf': { extension: 'pdf', kind: 'pdf' },
  'image/svg+xml': { extension: 'svg', kind: 'svg' },
  'image/png': { extension: 'png', kind: 'png' },
} as const satisfies Record<string, { extension: string; kind: 'ooxml' | 'pdf' | 'svg' | 'png' }>

export type AgentFileContentType = keyof typeof AGENT_FILE_TYPES
export type AgentFileKind = (typeof AGENT_FILE_TYPES)[AgentFileContentType]['kind']

export const AGENT_FILE_CONTENT_TYPES = Object.keys(AGENT_FILE_TYPES) as readonly AgentFileContentType[]

export const REFUSED_AGENT_FILE_TYPES: Readonly<Record<string, string>> = {
  'text/csv':
    'CSV cannot be filed: it has no place for the AI marking in its own bytes. File the table as an Excel workbook (.xlsx) instead.',
}

export const AGENT_FILE_MAX_BYTES = 25_000_000

export const AGENT_FILE_MAX_BASE64_LENGTH = Math.ceil(AGENT_FILE_MAX_BYTES / 3) * 4

export function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

export function agentFileTypeOf(contentType: string): AgentFileContentType | null {
  const normalized = normalizeContentType(contentType)
  return normalized in AGENT_FILE_TYPES ? (normalized as AgentFileContentType) : null
}

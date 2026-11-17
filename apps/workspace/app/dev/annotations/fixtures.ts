import type { FileItem } from '@/features/documents/components/project-file-workspace'
import type { RoomPeer } from '@/lib/annotations/room-types'
import type { AnnotationReplyView } from '@/lib/annotations/types'
import { PRODUCT_NAME } from '@/lib/brand'
import { LEGACY_AGENT_KIND } from '@/lib/legacy-agent-kind'

export const SHEET_WIDTH = 842
export const SHEET_HEIGHT = 595

export const FILE: FileItem = {
  id: 'dev-doc-annotations',
  filename: 'Grundriss_RG_Index-C.pdf',
  displayName: null,
  fileSize: 412_000,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-10-01T09:00:00Z',
  errorMessage: null,
  summary: 'Grundriss des Regelgeschosses im Maßstab 1:100 mit Gang, fünf Räumen, Bad, Technik und Stiege.',
  pageCount: 2,
  chunkCount: 3,
  contentTypes: ['drawing', 'text'],
  tags: ['Grundriss'],
  topics: null,
  capture: null,
  versionCount: 3,
  assignees: [{ userId: 'u-1', name: 'Miriam Hofer', email: 'm.hofer@example.at', profilePictureUrl: null }],
  revision: {
    supersededBy: null,
    supersedes: [{ id: 'dev-doc-index-b', filename: 'Grundriss_RG_Index-B.pdf' }],
    suggestion: null,
    changeSummary: null,
  },
}

export const INDEX_B = { id: 'dev-doc-index-b', filename: 'Grundriss_RG_Index-B.pdf' }

export const CARRY_HERE = { documentId: FILE.id, documentName: FILE.filename }

export const ME = { userId: 'u-1', name: 'Miriam Hofer' }
export const ANNA = { userId: 'u-2', name: 'Anna Berger' }
export const JAKOB = { userId: 'u-3', name: 'Jakob Huber' }
export const LENA = { userId: 'u-4', name: 'Lena Gruber' }
export const NAMES: Record<string, string> = { 'u-1': ME.name, 'u-2': ANNA.name, 'u-3': JAKOB.name, 'u-4': LENA.name }

export const pt = (x: number, y: number) => ({ x: +(x / SHEET_WIDTH).toFixed(4), y: +(1 - y / SHEET_HEIGHT).toFixed(4) })
export const region = (x0: number, y0: number, x1: number, y1: number) => {
  const a = pt(x0, y1)
  return { x: a.x, y: a.y, w: +((x1 - x0) / SHEET_WIDTH).toFixed(4), h: +((y1 - y0) / SHEET_HEIGHT).toFixed(4) }
}

export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export const base = {
  documentId: FILE.id,
  page: 1,
  w: null,
  h: null,
  basis: null,
  revisionNumber: 3,
  onCurrentRevision: true,
  createdBy: 'u-1',
  createdByName: ME.name,
  createdAt: minutesAgo(140),
  updatedAt: minutesAgo(140),
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  authorKind: 'person' as const,
  status: 'open' as const,
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  replies: [] as AnnotationReplyView[],
  canEdit: true,
  canDelete: true,
}

export const reply = (
  annotationId: string,
  by: { userId: string; name: string },
  minutes: number,
  body: string,
  mentions: AnnotationReplyView['mentions'] = []
): AnnotationReplyView => ({
  id: `${annotationId}-r${minutes}`,
  annotationId,
  authorKind: 'person',
  body,
  createdBy: by.userId,
  createdByName: by.name,
  createdAt: minutesAgo(minutes),
  addressesPiloti: false,
  mentions,
})

export const mention = (person: { userId: string; name: string }) => ({ targetId: person.userId, display: person.name })

export const agentReply = (
  annotationId: string,
  asker: { userId: string; name: string },
  id: string,
  body: string
): AnnotationReplyView => ({ ...reply(annotationId, asker, 0, body), id, authorKind: LEGACY_AGENT_KIND })

const peer = (who: { userId: string; name: string }, peerId: string): RoomPeer => ({ ...who, peerId, kind: 'person' })
export const annaPeer = peer(ANNA, 'peer-anna-0001')
export const jakobPeer = peer(JAKOB, 'peer-jakob-001')
export const lenaPeer = peer(LENA, 'peer-lena-0001')
export const agentPeer: RoomPeer = { peerId: 'agent-dev-conv', userId: ME.userId, name: PRODUCT_NAME, kind: LEGACY_AGENT_KIND }

import type { InternalAnnotationRequest } from '@/lib/annotations/types'
import { PRODUCT_NAME } from '@/lib/brand'

export interface Rendering {
  readonly component?: string
  readonly card?: string
  readonly step?: string
}

export interface Exempt {
  readonly exempt: string
}

export interface Gap {
  readonly gap: {
    readonly slice: string
    readonly reason: string
    readonly card?: string
    readonly step?: string
  }
}

export type SurfaceForm = Rendering | Exempt | Gap

export interface SurfaceCapability {
  readonly summary: string
  readonly tool?: string
  readonly annotationOp?: InternalAnnotationRequest['op']
  readonly operations?: readonly string[]
  readonly canvas: SurfaceForm
  readonly chat: SurfaceForm
}

const REVIEW = 'features/documents/components/review'
const ACTIVITY_CARD = 'features/cards/components/CanvasActivityCard.tsx'

export const SURFACE_CAPABILITIES = {
  look: {
    summary: 'Look at a page or a box on it, then answer from what was seen',
    tool: 'look',
    annotationOp: 'look',
    operations: ['document-look'],
    canvas: { component: `${REVIEW}/review-page-layer.tsx` },
    chat: { card: 'look', step: 'look', component: 'features/chat/components/reasoning/LookStepRow.tsx' },
  },
  point: {
    summary: 'Move ' + PRODUCT_NAME + '’s pointer to a place on a page for everyone in the document',
    tool: 'canvas__point',
    annotationOp: 'point',
    canvas: { component: `${REVIEW}/review-page-layer.tsx` },
    chat: { card: 'look' },
  },
  highlight: {
    summary: 'Show everyone a labelled box on a page for what the answer refers to',
    tool: 'canvas__highlight',
    annotationOp: 'highlight',
    canvas: { component: `${REVIEW}/review-page-layer.tsx` },
    chat: { card: 'look' },
  },
  propose: {
    summary: 'Propose marks a person takes over or dismisses',
    tool: 'canvas__mark',
    annotationOp: 'propose',
    canvas: { component: `${REVIEW}/mark-row.tsx` },
    chat: { card: 'canvas_activity', component: ACTIVITY_CARD },
  },
  createMark: {
    summary: 'Set a mark open, in the person’s name, when they asked for exactly that mark',
    tool: 'canvas__mark',
    annotationOp: 'create',
    operations: ['annotation-create'],
    canvas: { component: `${REVIEW}/composer.tsx` },
    chat: { card: 'canvas_activity', component: ACTIVITY_CARD },
  },
  updateMark: {
    summary: 'Change a mark: status, assignee, due date, kind, text',
    tool: 'canvas__update',
    annotationOp: 'update',
    operations: ['annotation-update'],
    canvas: { component: `${REVIEW}/mark-row.tsx` },
    chat: { card: 'canvas_activity', component: ACTIVITY_CARD },
  },
  deleteMark: {
    summary: 'Delete a mark a person set',
    tool: 'canvas__delete',
    annotationOp: 'delete',
    operations: ['annotation-delete'],
    canvas: { component: `${REVIEW}/mark-row.tsx` },
    chat: { card: 'canvas_activity', component: ACTIVITY_CARD },
  },
  replyToMark: {
    summary: 'Reply in a mark’s thread',
    tool: 'canvas__reply',
    annotationOp: 'reply',
    operations: ['annotation-reply-create'],
    canvas: { component: `${REVIEW}/thread-card.tsx` },
    chat: { card: 'canvas_activity', component: ACTIVITY_CARD },
  },
  editReply: {
    summary: 'Reword or remove a reply',
    operations: ['annotation-reply-update', 'annotation-reply-delete'],
    canvas: { component: `${REVIEW}/thread-card.tsx` },
    chat: { exempt: PRODUCT_NAME + ' has no tool to edit a reply: its own reply is final and a person’s is theirs to change' },
  },
  readMarks: {
    summary: 'Read the marks of a document or a project',
    tool: 'canvas__marks',
    annotationOp: 'list',
    operations: ['annotation-list', 'annotation-get', 'project-annotation-list'],
    canvas: { component: `${REVIEW}/review-panel.tsx` },
    chat: { exempt: 'A read whose result is the answer; the marks it quotes are cited as text' },
  },
  exportMarks: {
    summary: 'Export a document’s or a project’s marks as a file',
    operations: ['document-annotations-export', 'project-annotations-export'],
    canvas: { component: `${REVIEW}/review-export-menu.tsx` },
    chat: { exempt: 'A file download for a person; the door offers it to agents, the chat has no card for a file of marks' },
  },
  room: {
    summary: 'See who has the document open, on which page, and what they select',
    tool: 'canvas__room',
    annotationOp: 'room',
    canvas: { component: `${REVIEW}/cursor-chat.tsx` },
    chat: { exempt: 'Who is in a document has no meaning in a conversation; a read whose result is the answer' },
  },
  leave: {
    summary: PRODUCT_NAME + ' leaves the document’s room when its turn ends',
    annotationOp: 'leave',
    canvas: { component: `${REVIEW}/review-page-layer.tsx` },
    chat: { exempt: 'The turn harness’s own clean-up, not a capability of the person or of ' + PRODUCT_NAME },
  },
  compareRevisions: {
    summary: 'Compare two Fassungen of a document: what changed on a page, boxed',
    operations: ['document-revision-compare', 'document-revision-candidates', 'document-revision-link-set'],
    canvas: { component: 'features/documents/components/document-revisions.tsx' },
    chat: { card: 'revision_compare', component: 'features/cards/components/RevisionCompareCard.tsx' },
  },
  askAboutBox: {
    summary: 'Draw a box on a page and ask about it; ' + PRODUCT_NAME + ' answers in context of that box',
    canvas: { component: 'features/documents/hooks/use-canvas-ask.ts' },
    chat: { component: 'features/chat/lib/canvas-bridge.ts' },
  },
  askAboutAnswerPart: {
    summary: 'Select part of an answer and ask about it; the next answer is about exactly that part',
    canvas: { exempt: 'The canvas shows a document, not an answer; its form of this is the box drawn on a page (askAboutBox)' },
    chat: { component: 'features/chat/components/AnswerExcerptAsk.tsx' },
  },
  readSelectedRegion: {
    summary: PRODUCT_NAME + ' reads what the person selected or points at when the question says "here"',
    tool: 'canvas__room',
    canvas: { component: `${REVIEW}/document-review.tsx` },
    chat: { component: 'features/documents/lib/review-focus.ts' },
  },
  referenceDocument: {
    summary: 'Pick a document from the live workspace search into a message, which makes it the question’s subject',
    operations: ['workspace-search'],
    canvas: { exempt: 'The canvas shows one document, which is already the subject of what is asked there' },
    chat: { component: 'features/search/components/composer-search-picker.tsx' },
  },
  openAtPlace: {
    summary: 'Open a document at a page, with a region glowing',
    canvas: { component: `${REVIEW}/document-review.tsx` },
    chat: { card: 'look', component: 'features/knowledge/components/page-place-button.tsx' },
  },
  showInViewer: {
    summary: 'Take the asker to a place: a page, a passage or a box on it, a Fassung comparison, a model element',
    tool: 'show_in_viewer',
    operations: ['document-get'],
    canvas: { component: 'features/documents/components/file-preview-pane.tsx' },
    chat: { component: 'features/chat/components/ViewerActionRow.tsx' },
  },
} as const satisfies Readonly<Record<string, SurfaceCapability>>

export type SurfaceCapabilityName = keyof typeof SURFACE_CAPABILITIES

export const CANVAS_RELATED_OPERATIONS = [
  'document-look',
  'document-revision-compare',
  'document-revision-candidates',
  'document-revision-link-set',
] as const

export function isCanvasOperation(name: string): boolean {
  return /^(annotation-|document-annotations-|project-annotation)/.test(name) || (CANVAS_RELATED_OPERATIONS as readonly string[]).includes(name)
}

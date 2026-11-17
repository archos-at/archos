import type {
  RefusalReason,
  ViewerActionCall,
  ViewerActionOutcome,
  ViewerActionRunner,
} from '@/features/chat/lib/viewer-actions'
import { buildModelHref, buildOfficeShelfModelHref } from '@/features/bim/lib/model-link'
import { placeRegions } from '@/features/knowledge/lib/page-place'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { CompareFile } from '../components/revision-compare/types'
import { toFileItem, type DocumentWireRow } from './file-item'
import { openFilePeek } from './open-file-peek'
import { useFilePreviewStore } from '../stores/file-preview-store'

type ReadRow = DocumentWireRow & {
  projectId: string | null
  collectionName?: string | null
  revision?: RevisionLinks | null
}

export interface ViewerActionRunnerDeps {
  hasRoom: () => boolean
  openCompare: (older: CompareFile, newer: CompareFile) => void
  closeCompare: (older: CompareFile, newer: CompareFile) => boolean
  navigate: (href: string) => void
  currentHref: () => string
  fetcher?: typeof fetch
}

type Read = { row: ReadRow } | { outcome: ViewerActionOutcome }

const refused = (reason: RefusalReason): ViewerActionOutcome => ({ outcome: 'refused', reason })

async function readDocument(id: string, fetcher: typeof fetch): Promise<Read> {
  let response: Response
  try {
    response = await fetcher(`/api/documents/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } })
  } catch {
    return { outcome: { outcome: 'failed' } }
  }
  if (response.status === 403 || response.status === 404) return { outcome: refused('unavailable') }
  if (!response.ok) return { outcome: { outcome: 'failed' } }
  const body = (await response.json().catch(() => null)) as { document?: ReadRow } | null
  if (!body?.document || body.document.id !== id) return { outcome: { outcome: 'failed' } }
  return { row: body.document }
}

const replaces = (newer: ReadRow, older: ReadRow): boolean => {
  const links = newer.revision
  if (links?.history?.some((entry) => entry.id === older.id)) return true
  if (links?.supersedes.some((entry) => entry.id === older.id)) return true
  return older.revision?.supersededBy?.id === newer.id
}

const pairOf = (first: ReadRow, second: ReadRow): { older: ReadRow; newer: ReadRow } | RefusalReason => {
  const sameShelf =
    first.projectId === second.projectId && (first.collectionName ?? null) === (second.collectionName ?? null)
  if (!sameShelf) return 'notRevisions'
  if (replaces(first, second)) return { older: second, newer: first }
  if (replaces(second, first)) return { older: first, newer: second }
  return 'notRevisions'
}

const regionsOf = (call: ViewerActionCall) => {
  const { region, page, document_id, document_name } = call.args
  if (!region || !page) return null
  return placeRegions({ document: { id: document_id, name: document_name, shelf: 'stored' }, page, frame: 'page', region })
}

function openAtPlace(call: ViewerActionCall, row: ReadRow, room: boolean): ViewerActionOutcome {
  const before = useFilePreviewStore.getState()
  const previous = { file: before.file, mode: before.mode, context: before.context, hidden: before.hidden, target: before.viewerTarget }
  openFilePeek({
    file: toFileItem(row),
    source: row.projectId ? 'project' : 'office',
    projectId: row.projectId,
    bindComposerSubject: false,
    presentation: room ? 'peek' : 'modal',
  })
  const { page, passage } = call.args
  useFilePreviewStore.getState().setViewerTarget({
    fileId: row.id,
    page: page ?? null,
    passage: call.tool_call_name === 'highlight_passage' ? passage : null,
    regions: call.tool_call_name === 'highlight_region' ? regionsOf(call) : null,
    key: call.tool_call_id,
  })
  const undo = (): boolean => {
    const store = useFilePreviewStore.getState()
    if (store.file?.id !== row.id) return false
    if (!previous.file) {
      store.close()
      return true
    }
    store.open(previous.file, previous.mode, previous.context)
    if (previous.hidden) store.hide()
    store.setViewerTarget(previous.target)
    return true
  }
  return { outcome: 'shown', where: room ? 'beside' : 'over', undo }
}

const modelViewOf = (href: string): string => {
  const url = new URL(href, 'http://in-app.invalid')
  return `${url.pathname}?model=${url.searchParams.get('model') ?? ''}`
}

export function createViewerActionRunner(deps: ViewerActionRunnerDeps): ViewerActionRunner {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init))

  const compare = async (call: ViewerActionCall): Promise<ViewerActionOutcome> => {
    const againstId = call.args.against_document_id
    if (!againstId) return refused('notRevisions')
    const [first, second] = await Promise.all([readDocument(call.args.document_id, fetcher), readDocument(againstId, fetcher)])
    if ('outcome' in first) return first.outcome
    if ('outcome' in second) return second.outcome
    const pair = pairOf(first.row, second.row)
    if (typeof pair === 'string') return refused(pair)
    const older = { id: pair.older.id, filename: pair.older.filename }
    const newer = { id: pair.newer.id, filename: pair.newer.filename }
    deps.openCompare(older, newer)
    return { outcome: 'shown', where: 'compare', undo: () => deps.closeCompare(older, newer) }
  }

  const model = (call: ViewerActionCall, row: ReadRow): ViewerActionOutcome => {
    const view = { model: row.filename, element: call.args.element ?? undefined }
    const href = row.projectId ? buildModelHref(row.projectId, view) : buildOfficeShelfModelHref(view)
    const from = deps.currentHref()
    deps.navigate(href)
    const undoable = (): boolean => modelViewOf(deps.currentHref()) === modelViewOf(href)
    const undo = (): boolean => {
      if (!undoable()) return false
      deps.navigate(from)
      return true
    }
    return { outcome: 'shown', where: 'model', undo, undoable }
  }

  return {
    hasRoom: deps.hasRoom,
    run: async (call) => {
      if (call.tool_call_name === 'compare_revisions') return compare(call)
      const read = await readDocument(call.args.document_id, fetcher)
      if ('outcome' in read) return read.outcome
      if (call.tool_call_name === 'focus_ifc_element') return model(call, read.row)
      return openAtPlace(call, read.row, deps.hasRoom())
    },
  }
}

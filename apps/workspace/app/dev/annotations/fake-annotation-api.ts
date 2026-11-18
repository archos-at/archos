import { AGENT_KIND, isAgentKind } from '@/lib/agent-kind'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentMentionId } from '@/lib/mentions/types'
import type { AnnotationReplyView, AnnotationView } from '@/lib/annotations/types'
import { AGENT_PROPOSALS, ANNOTATION_FIXTURES, INDEX_B_ANNOTATION_FIXTURES } from './annotation-fixtures'
import { ANNA, CARRY_HERE, FILE, INDEX_B, JAKOB, LENA, ME, NAMES, agentPeer, agentReply, base, reply, region } from './fixtures'
import { buildSheet, protocolPdf } from './pdf-fixtures'
import { broadcast } from './room-broadcast'
import { BOX_ANSWER, CORRIDOR_ANSWER, FIXED_VERDICTS, OIB_RL_4, REVIEW_ANSWER, threadAnswer } from './scripted-replies'
import type { ScriptedTurn } from './scripted-turns'
import { emit, finish, play, streamAnswer, synthesis } from './scripted-turns'

let annotations: AnnotationView[] = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('blank') ? [] : ANNOTATION_FIXTURES
let nextNumber = 7
let unreadMarks = ['ann-1']
let indexB: AnnotationView[] = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('blank') ? [] : INDEX_B_ANNOTATION_FIXTURES

const WAKES = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('wakes')

const CARRIED_FAILS_UNTIL =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('carriedFails') ? Date.now() + 2_000 : 0

const wakeReply = (annotationId: string) => {
  const answer = agentReply(
    annotationId,
    ME,
    `${annotationId}-wake-${Date.now()}`,
    'Im Schnitt B-B sind 1,20 m zwischen den Wangen kotiert; die Statik rechnet mit 1,10 m.'
  )
  annotations = annotations.map((one) => (one.id === annotationId ? { ...one, replies: [...one.replies, answer] } : one))
  broadcast({
    kind: 'annotations.changed',
    annotationIds: [annotationId],
    change: 'replied',
    actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: AGENT_KIND },
  })
}

export const proposeFindings = () => {
  const fresh = AGENT_PROPOSALS.filter((proposal) => !annotations.some((annotation) => annotation.id === proposal.id))
  if (fresh.length === 0) return
  const proposed = fresh.map((proposal) => ({ ...proposal, number: nextNumber++, createdAt: new Date().toISOString() }))
  annotations = [...annotations, ...proposed]
  broadcast({
    kind: 'annotations.changed',
    annotationIds: proposed.map((proposal) => proposal.id),
    change: 'created',
    actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: AGENT_KIND },
  })
}

export interface FocusBox {
  page: number
  x: number
  y: number
  w: number
  h: number
  annotationId: string | null
}

const CORRIDOR = region(50, 270, 570, 320)
const onCorridor = (box: FocusBox) => {
  const middle = box.y + box.h / 2
  return middle > CORRIDOR.y - 0.03 && middle < CORRIDOR.y + CORRIDOR.h + 0.03
}

export const answerAboutBox = (turn: ScriptedTurn, box: FocusBox, replyInThread: boolean) => {
  const corridor = onCorridor(box)
  const thread = replyInThread && box.annotationId ? annotations.find((one) => one.id === box.annotationId) : undefined
  const text = thread ? threadAnswer(thread.number) : corridor ? CORRIDOR_ANSWER : BOX_ANSWER
  const mark = thread ? `Anmerkung ${thread.number}` : corridor ? 'Breite nicht kotiert' : 'Keine Maße im Ausschnitt'
  const roomBox = { page: box.page, x: box.x, y: box.y, w: box.w, h: box.h }
  const view = { id: 'step-view', kind: 'tool', tool: 'look' } as const
  const reading = thread
    ? ({ id: 'step-read', kind: 'status', slot: 'annotations', key: 'status.action.annotationsRead' } as const)
    : ({
        id: 'step-punkt',
        kind: 'status',
        slot: 'retrieval',
        key: 'status.retrieval.clause',
        values: { document: 'OIB-RL 4', clause: '2.2.1' },
      } as const)
  const writing = thread
    ? ({ id: 'step-reply', kind: 'status', slot: 'annotations', key: 'status.action.annotationsReply' } as const)
    : synthesis
  play(turn, [
    [
      150,
      () => {
        emit(turn, { type: 'RUN_STARTED', message_id: turn.messageId })
        broadcast({ kind: 'presence', peer: agentPeer, state: 'here', ttlMs: 25_000 })
        broadcast({ kind: 'activity', peer: agentPeer, state: 'reading', box: roomBox, label: 'sieht sich den Ausschnitt an' })
        broadcast({
          kind: 'cursor',
          peer: agentPeer,
          tool: 'select',
          cursor: { page: box.page, x: box.x + box.w / 2, y: box.y + box.h / 2 },
          label: 'Hier',
        })
      },
    ],
    [100, () => emit(turn, { type: 'STEP_STARTED', step: { ...view, status: 'running' } })],
    [
      600,
      () =>
        broadcast({
          kind: 'highlight',
          peer: agentPeer,
          box: roomBox,
          label: mark,
          ttlMs: 8_000,
        }),
    ],
    [
      700,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: { ...view, status: 'ok' } })
        emit(turn, { type: 'STEP_STARTED', step: reading })
      },
    ],
    [
      800,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: reading })
        emit(turn, { type: 'STEP_STARTED', step: writing })
        if (thread) return
        emit(turn, {
          type: 'STEP_FINISHED',
          step: {
            id: 'step-sources',
            kind: 'sources',
            tool: 'search_knowledge',
            lanes: [
              {
                key: 'oib',
                kind: 'building_law',
                label: 'OIB-Richtlinien',
                hit_count: 1,
                sources: [{ name: 'OIB-RL_4_2023.pdf', title: OIB_RL_4.file_name, detail: 'Pkt. 2.2.1 S. 4' }],
              },
            ],
          },
        })
      },
    ],
    ...streamAnswer(turn, text),
    [
      0,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: writing })
        if (thread) {
          const answer = agentReply(thread.id, ME, `${thread.id}-${turn.messageId}`, text)
          annotations = annotations.map((one) => (one.id === thread.id ? { ...one, replies: [...one.replies, answer] } : one))
          broadcast({
            kind: 'annotations.changed',
            annotationIds: [thread.id],
            change: 'replied',
            actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: AGENT_KIND },
          })
        }
        finish(turn, text, thread ? [] : [OIB_RL_4])
      },
    ],
  ])
}

export const reviewDocument = (turn: ScriptedTurn) => {
  const read = { id: 'step-read', kind: 'status', slot: 'annotations', key: 'status.action.annotationsRead' } as const
  const propose = { id: 'step-propose', kind: 'status', slot: 'annotations', key: 'status.action.annotationsPropose' } as const
  play(turn, [
    [
      150,
      () => {
        emit(turn, { type: 'RUN_STARTED', message_id: turn.messageId })
        emit(turn, { type: 'STEP_STARTED', step: read })
        broadcast({ kind: 'presence', peer: agentPeer, state: 'here', ttlMs: 25_000 })
        broadcast({
          kind: 'activity',
          peer: agentPeer,
          state: 'reading',
          box: { page: 1, x: 0, y: 0, w: 1, h: 1 },
          label: 'geht das Dokument durch',
        })
      },
    ],
    [
      900,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: read })
        emit(turn, { type: 'STEP_STARTED', step: propose })
      },
    ],
    [
      900,
      () => {
        proposeFindings()
        emit(turn, { type: 'STEP_FINISHED', step: propose })
        emit(turn, { type: 'STEP_STARTED', step: synthesis })
      },
    ],
    ...streamAnswer(turn, REVIEW_ANSWER),
    [
      0,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: synthesis })
        finish(turn, REVIEW_ANSWER, [])
      },
    ],
  ])
}

export const checkFixed = (turn: ScriptedTurn, question: string) => {
  const onIndexB = question.includes(INDEX_B.filename)
  const read = { id: 'step-read', kind: 'status', slot: 'annotations', key: 'status.action.annotationsRead' } as const
  const replyStep = { id: 'step-reply', kind: 'status', slot: 'annotations', key: 'status.action.annotationsReply' } as const
  const answer = (one: AnnotationView): AnnotationView => {
    const verdict = FIXED_VERDICTS[one.id] ?? 'Weiterhin offen: An der Stelle hat sich in dieser Fassung nichts geändert.'
    return { ...one, replies: [...one.replies, agentReply(one.id, ME, `${one.id}-check-${turn.messageId}`, verdict)] }
  }
  const text = 'Ich habe die Anmerkungen an der Stelle in der aktuellen Fassung angesehen und in jedem Verlauf geantwortet. Erledigen müssen Sie sie selbst.'
  play(turn, [
    [
      150,
      () => {
        emit(turn, { type: 'RUN_STARTED', message_id: turn.messageId })
        emit(turn, { type: 'STEP_STARTED', step: read })
        broadcast({ kind: 'presence', peer: agentPeer, state: 'here', ttlMs: 25_000 })
        broadcast({ kind: 'activity', peer: agentPeer, state: 'reading', box: { page: 1, x: 0, y: 0, w: 1, h: 1 }, label: 'prüft, was behoben ist' })
      },
    ],
    [
      900,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: read })
        emit(turn, { type: 'STEP_STARTED', step: replyStep })
      },
    ],
    [
      900,
      () => {
        if (onIndexB) {
          indexB = indexB.map((one) => (one.status === 'open' ? answer(one) : one))
        } else {
          const checked = annotations.filter((one) => !one.onCurrentRevision && one.status === 'open')
          annotations = annotations.map((one) => (checked.includes(one) ? answer(one) : one))
          broadcast({
            kind: 'annotations.changed',
            annotationIds: checked.map((one) => one.id),
            change: 'replied',
            actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: AGENT_KIND },
          })
        }
        emit(turn, { type: 'STEP_FINISHED', step: replyStep })
        emit(turn, { type: 'STEP_STARTED', step: synthesis })
      },
    ],
    ...streamAnswer(turn, text),
    [
      0,
      () => {
        emit(turn, { type: 'STEP_FINISHED', step: synthesis })
        finish(turn, text, [])
      },
    ],
  ])
}

const filed = new Map<string, { id: string; versions: number }>()

const json = (body: unknown, status = 200) => Response.json(body, { status })

export const fakeFetch = (real: typeof fetch) => async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = () => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  if (url.endsWith('/api/realtime/send')) return new Response(null, { status: 204 })
  if (url.includes('/api/inbox/unread-anchors')) return json({ anchorIds: unreadMarks })
  if (method === 'POST' && url.endsWith('/api/inbox/read')) {
    const anchor = body().anchorId
    const affected = unreadMarks.includes(String(anchor)) ? 1 : 0
    unreadMarks = unreadMarks.filter((id) => id !== anchor)
    return json({ affected, pending: 0 })
  }
  if (url.endsWith(`/api/documents/${INDEX_B.id}/annotations`)) {
    if (Date.now() < CARRIED_FAILS_UNTIL) return json({ error: 'Unavailable', code: 'UNAVAILABLE' }, 503)
    return json({ annotations: indexB, canAnnotate: true, pilotiWakes: WAKES })
  }
  const fromB = new RegExp(`/api/documents/${INDEX_B.id}/annotations/([^/?]+)$`).exec(url)
  if (fromB && method === 'PATCH') {
    const source = indexB.find((annotation) => annotation.id === fromB[1])
    if (!source || source.status !== 'open') return json({ error: 'Conflict', code: 'CONFLICT' }, 409)
    const now = new Date().toISOString()
    if (body().status === 'resolved') {
      const closed: AnnotationView = { ...source, status: 'resolved', closedBy: ME.userId, closedByName: ME.name, closedAt: now, carryTarget: null }
      indexB = indexB.map((annotation) => (annotation.id === closed.id ? closed : annotation))
      return json({ annotation: closed })
    }
    const copy: AnnotationView = {
      ...source,
      id: `ann-${nextNumber}`,
      documentId: FILE.id,
      number: nextNumber,
      revisionNumber: 3,
      onCurrentRevision: true,
      createdAt: now,
      updatedAt: now,
      carriedFrom: { annotationId: source.id, documentId: INDEX_B.id, number: source.number, documentName: INDEX_B.filename },
      carryTarget: null,
    }
    nextNumber += 1
    indexB = indexB.map((annotation) =>
      annotation.id === source.id
        ? { ...annotation, status: 'resolved', closedBy: ME.userId, closedByName: ME.name, closedAt: now, carryTarget: null }
        : annotation
    )
    annotations = [...annotations, copy]
    return json({ annotation: copy })
  }
  if (url.startsWith(`/api/documents/${FILE.id}/annotations/export?`)) {
    const format = new URL(url, window.location.href).searchParams.get('format') ?? 'pdf'
    const name = `Anmerkungen – Grundriss_RG_Index-C – Fassung 3.${format}`
    return new Response(format === 'pdf' ? protocolPdf() : '# Anmerkungen – Grundriss_RG_Index-C\n', {
      headers: {
        'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/markdown',
        'Content-Disposition': `attachment; filename="protokoll.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    })
  }
  if (method === 'POST' && url.endsWith('/api/documents/upload')) {
    const file = (init?.body as FormData).get('file') as File
    const known = filed.get(file.name)
    const entry = known ? { ...known, versions: known.versions + 1 } : { id: `dev-protokoll-${filed.size + 1}`, versions: 1 }
    filed.set(file.name, entry)
    return json({ documentId: entry.id, jobId: null, status: 'pending', filename: file.name }, 201)
    }
  const ownReply = new RegExp(`/api/documents/${FILE.id}/annotations/([^/?]+)/replies/([^/?]+)$`).exec(url)
  if (ownReply) {
    const current = annotations.find((annotation) => annotation.id === ownReply[1])
    const target = current?.replies.find((candidate) => candidate.id === ownReply[2])
    if (!current || !target) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    if (target.authorKind !== 'person' || target.createdBy !== ME.userId) {
      return json({ error: 'Only the person who wrote an answer can change it.', code: 'FORBIDDEN' }, 403)
    }
    if (current.status === 'resolved' || current.status === 'dismissed') {
      return json({ error: 'Closed', code: 'UNPROCESSABLE', details: { reason: 'mark-closed' } }, 422)
    }
    const rest = current.replies.filter((candidate) => candidate.id !== target.id)
    if (method === 'DELETE') {
      annotations = annotations.map((annotation) => (annotation.id === current.id ? { ...current, replies: rest } : annotation))
      return new Response(null, { status: 204 })
    }
    const input = body()
    const edited: AnnotationReplyView = {
      ...target,
      body: String(input.body).trim(),
      mentions: ((input.mentions as AnnotationReplyView['mentions']) ?? target.mentions ?? []).filter(
        (one) => !isAgentMentionId(one.targetId) || (target.mentions ?? []).some((had) => isAgentMentionId(had.targetId))
      ),
      editedAt: new Date().toISOString(),
    }
    const next = { ...current, replies: current.replies.map((candidate) => (candidate.id === target.id ? edited : candidate)) }
    annotations = annotations.map((annotation) => (annotation.id === next.id ? next : annotation))
    return json({ annotation: next })
  }
  const replies = new RegExp(`/api/documents/${FILE.id}/annotations/([^/?]+)/replies$`).exec(url)
  if (replies) {
    const current = annotations.find((annotation) => annotation.id === replies[1])
    if (!current) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    const input = body()
    const added = {
      ...reply(current.id, ME, 0, String(input.body).trim(), (input.mentions as AnnotationReplyView['mentions']) ?? []),
      id: `${current.id}-posted-${Date.now()}`,
      addressesPiloti: input.addressesPiloti === true,
    }
    const next = { ...current, replies: [...current.replies, added], updatedAt: new Date().toISOString() }
    annotations = annotations.map((annotation) => (annotation.id === next.id ? next : annotation))
    const answersAgent = isAgentKind(current.authorKind) && current.kind === 'question' && current.status !== 'resolved' && current.status !== 'dismissed'
    const wake = !added.addressesPiloti && !answersAgent ? 'none' : WAKES ? 'queued' : 'off'
    if (wake === 'queued') setTimeout(() => wakeReply(current.id), 4_000)
    return json({ annotation: next, replyId: added.id, wake }, 201)
  }
  const one = new RegExp(`/api/documents/${FILE.id}/annotations/([^/?]+)$`).exec(url)
  if (one) {
    const current = annotations.find((annotation) => annotation.id === one[1])
    if (!current) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    if (method === 'GET') return json({ annotation: current })
    if (method === 'DELETE') {
      annotations = annotations.filter((annotation) => annotation.id !== current.id)
      return new Response(null, { status: 204 })
    }
    const { delegateToPiloti, carryToCurrent, expectedStatus: _seen, ...change } = body() as Partial<AnnotationView> & {
      delegateToPiloti?: boolean
      carryToCurrent?: boolean
      expectedStatus?: string
    }
    const now = new Date().toISOString()
    if (carryToCurrent) {
      const carried = { ...current, revisionNumber: 3, onCurrentRevision: true, carryTarget: null, updatedAt: now }
      annotations = annotations.map((annotation) => (annotation.id === carried.id ? carried : annotation))
      return json({ annotation: carried })
    }
    const delegation =
      delegateToPiloti === undefined
        ? {}
        : delegateToPiloti
          ? { delegatedBy: ME.userId, delegatedByName: ME.name, delegatedAt: now }
          : { delegatedBy: null, delegatedByName: null, delegatedAt: null }
    const status = change.status ?? current.status
    const moved = status !== current.status
    const next: AnnotationView = {
      ...current,
      ...change,
      ...delegation,
      status,
      ...(change.assigneeUserId !== undefined ? { assigneeName: change.assigneeUserId ? NAMES[change.assigneeUserId] ?? null : null } : {}),
      ...(moved && (status === 'resolved' || status === 'dismissed')
        ? { closedBy: ME.userId, closedByName: ME.name, closedAt: now, carryTarget: null }
        : {}),
      ...(moved && status === 'open'
        ? { closedBy: null, closedByName: null, closedAt: null, carryTarget: current.onCurrentRevision ? null : CARRY_HERE }
        : {}),
      ...(moved && status === 'open' && isAgentKind(current.authorKind) && !current.acceptedBy
        ? { acceptedBy: ME.userId, acceptedByName: ME.name }
        : {}),
      updatedAt: now,
    }
    annotations = annotations.map((annotation) => (annotation.id === next.id ? next : annotation))
    return json({ annotation: next, ...(delegateToPiloti ? { wake: 'queued' } : {}) })
  }
  if (url.endsWith(`/api/documents/${FILE.id}/annotations`)) {
    if (method === 'POST') {
      const input = body() as Pick<
        AnnotationView,
        'page' | 'shape' | 'x' | 'y' | 'w' | 'h' | 'kind' | 'body' | 'mentions' | 'assigneeUserId' | 'dueOn'
      >
      const created: AnnotationView = {
        ...base,
        ...input,
        mentions: input.mentions ?? [],
        w: input.w ?? null,
        h: input.h ?? null,
        body: input.body.trim(),
        assigneeUserId: input.assigneeUserId ?? null,
        assigneeName: input.assigneeUserId ? NAMES[input.assigneeUserId] ?? null : null,
        dueOn: input.dueOn ?? null,
        id: `ann-${nextNumber}`,
        number: nextNumber,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      nextNumber += 1
      annotations = [...annotations, created]
      return json({ annotation: created }, 201)
    }
    return json({ annotations, canAnnotate: true, pilotiWakes: WAKES })
  }
  if (method === 'POST' && url.endsWith(`/api/documents/${FILE.id}/thread`)) {
    return json({ conversationId: 's_dev_document_thread' })
  }
  if (url.endsWith(`/api/documents/${FILE.id}/file`)) {
    return new Response(buildSheet(), { headers: { 'Content-Type': 'application/pdf' } })
  }
  if (method === 'POST' && /\/api\/conversations$/.test(url)) {
    const input = body()
    const now = new Date().toISOString()
    return json(
      {
        id: input.id,
        title: input.title ?? null,
        projectId: input.projectId ?? null,
        subjectResourceType: input.subjectResourceType ?? null,
        subjectResourceId: input.subjectResourceId ?? null,
        visibility: 'private',
        createdBy: ME.userId,
        createdAt: now,
        updatedAt: now,
      },
      201
    )
  }
  const stored = /\/api\/conversations\/([^/?]+)\/messages$/.exec(url)
  if (method === 'POST' && stored) {
    const input = body()
    return json(
      [
        {
          id: input.id,
          conversationId: decodeURIComponent(stored[1]),
          role: input.role,
          content: input.content,
          messageType: input.messageType,
          createdBy: ME.userId,
          createdAt: new Date().toISOString(),
        },
      ],
      201
    )
  }
  if (url.endsWith(`/api/documents/${FILE.id}/preview`)) return json({ url: `/api/documents/${FILE.id}/file` })
  if (/\/api\/documents\/.+\/visual-details$/.test(url)) return json({ details: [] })
  if (/\/api\/assignments\/document\/.+\/candidates(\?.*)?$/.test(url)) {
    const writers = [
      { userId: 'u-2', name: ANNA.name, email: 'a.berger@example.at', profilePictureUrl: null },
      { userId: 'u-3', name: JAKOB.name, email: 'j.huber@example.at', profilePictureUrl: null },
    ]
    const reader = { userId: 'u-4', name: LENA.name, email: 'l.gruber@example.at', profilePictureUrl: null }
    return json({ candidates: url.includes('access=write') ? writers : [...writers, reader] })
  }
  return real(input, init)
}

'use client'

import type { JSX } from 'react'
import type { z } from 'zod'
import type { wireEventSchema } from '@/adapters/api/wire-v2'
import { FilePreviewPane } from '@/features/documents/components/file-preview-pane'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import type { RoomEvent, RoomPeer } from '@/lib/annotations/room-types'
import type { RealtimeFrame } from '@/lib/realtime/types'
import type { AnnotationReplyView, AnnotationView } from '@/lib/annotations/types'
import { assemblePdf, buildPdf, pdfString } from '../_fixtures/sample-pdf'
import { PRODUCT_NAME } from '@/lib/brand'

const SHEET_WIDTH = 842
const SHEET_HEIGHT = 595

const sheetContent = (): string => {
  const ops: string[] = ['0 0 0 RG']
  const rect = (x: number, y: number, w: number, h: number, width = 0.8) =>
    ops.push(`${width} w ${x} ${y} ${w} ${h} re S`)
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.5) =>
    ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`)
  const text = (x: number, y: number, size: number, value: string, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(value)}) Tj ET`)

  rect(50, 80, 520, 420, 2.4)
  line(50, 270, 570, 270, 1.2)
  line(50, 320, 570, 320, 1.2)
  for (const x of [190, 330, 450]) {
    line(x, 320, x, 500, 1.2)
    line(x, 80, x, 270, 1.2)
  }
  for (const x of [110, 250, 380, 500]) {
    ops.push(`1 1 1 RG 3 w ${x} 320 m ${x + 26} 320 l S 0 0 0 RG`)
    line(x, 320, x, 346, 0.4)
  }
  rect(470, 110, 80, 140, 0.8)
  for (let step = 0; step <= 9; step += 1) line(470, 110 + step * 14, 550, 110 + step * 14, 0.5)
  for (const [x, y] of [
    [90, 500],
    [230, 500],
    [90, 80],
    [230, 80],
  ]) {
    ops.push(`1 1 1 RG 3 w ${x} ${y} m ${x + 60} ${y} l S 0 0 0 RG`)
    line(x, y - 2, x + 60, y - 2, 0.4)
    line(x, y + 2, x + 60, y + 2, 0.4)
  }
  text(90, 420, 10, 'Wohnen 1')
  text(230, 420, 10, 'Wohnen 2')
  text(370, 420, 10, 'Bad')
  text(480, 420, 10, 'Technik')
  text(90, 180, 10, 'Zimmer 1')
  text(230, 180, 10, 'Zimmer 2')
  text(360, 180, 10, 'Abstellraum')
  text(478, 258, 9, 'Stiege')
  text(240, 292, 10, 'Gang (Fluchtweg)')
  text(50, 515, 12, 'Grundriss Regelgeschoss  1:100', true)
  rect(600, 40, 220, 70, 0.8)
  text(612, 88, 10, 'Wohnbau Nord', true)
  text(612, 70, 9, 'Grundriss RG, Index C')
  text(612, 54, 9, 'Architektur Muster ZT GmbH')
  return ops.join('\n') + '\n'
}

const buildSheet = (): Uint8Array<ArrayBuffer> => {
  const content = sheetContent()
  return assemblePdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 7 0 R]/Count 2>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}]` +
      '/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}]` +
      '/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
  ])
}

const FILE: FileItem = {
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

const INDEX_B = { id: 'dev-doc-index-b', filename: 'Grundriss_RG_Index-B.pdf' }

const CARRY_HERE = { documentId: FILE.id, documentName: FILE.filename }

const ME = { userId: 'u-1', name: 'Miriam Hofer' }
const ANNA = { userId: 'u-2', name: 'Anna Berger' }
const JAKOB = { userId: 'u-3', name: 'Jakob Huber' }
const LENA = { userId: 'u-4', name: 'Lena Gruber' }
const NAMES: Record<string, string> = { 'u-1': ME.name, 'u-2': ANNA.name, 'u-3': JAKOB.name, 'u-4': LENA.name }

const pt = (x: number, y: number) => ({ x: +(x / SHEET_WIDTH).toFixed(4), y: +(1 - y / SHEET_HEIGHT).toFixed(4) })
const region = (x0: number, y0: number, x1: number, y1: number) => {
  const a = pt(x0, y1)
  return { x: a.x, y: a.y, w: +((x1 - x0) / SHEET_WIDTH).toFixed(4), h: +((y1 - y0) / SHEET_HEIGHT).toFixed(4) }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const base = {
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

const reply = (
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

const mention = (person: { userId: string; name: string }) => ({ targetId: person.userId, display: person.name })

const agentReply = (
  annotationId: string,
  asker: { userId: string; name: string },
  id: string,
  body: string
): AnnotationReplyView => ({ ...reply(annotationId, asker, 0, body), id, authorKind: 'piloti' })

let annotations: AnnotationView[] = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('blank') ? [] : [
  {
    ...base,
    id: 'ann-1',
    number: 1,
    shape: 'point',
    ...pt(263, 333),
    kind: 'defect',
    body: 'Tür von Wohnen 2 in den Fluchtweg ohne Angabe der Feuerwiderstandsklasse. EI2 30-C eintragen.',
    assigneeUserId: 'u-2',
    assigneeName: ANNA.name,
    dueOn: '2026-10-10',
    canDelete: false,
    deleteRefused: 'discussed',
    replies: [
      reply('ann-1', ANNA, 95, '@Miriam Hofer Kommt mit Index D. Gilt das auch für die Tür vom Bad?', [mention(ME)]),
      {
        ...reply('ann-1', ME, 80, 'Nein, Bad geht nicht in den Gang. Nur Wohnen 1 und 2. @Jakob Huber, bitte in Index D nachziehen.', [
          mention(JAKOB),
        ]),
        editedAt: minutesAgo(78),
      },
    ],
  },
  {
    ...base,
    id: 'ann-2',
    number: 2,
    shape: 'region',
    ...region(470, 110, 550, 250),
    kind: 'question',
    body: 'Laufbreite der Stiege an die Statik: 1,20 m oder 1,10 m zwischen den Wangen?',
    createdBy: 'u-3',
    createdByName: JAKOB.name,
    canDelete: false,
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(60),
    delegatedBy: 'u-3',
    delegatedByName: JAKOB.name,
    delegatedAt: minutesAgo(20),
  },
  {
    ...base,
    id: 'ann-3',
    number: 3,
    shape: 'point',
    ...pt(380, 440),
    kind: 'hint',
    body: 'Bad: Lüftung über Dach, Schacht im Technikraum. @Anna Berger, passt das zur Haustechnik?',
    mentions: [mention(ANNA)],
    status: 'resolved',
    closedBy: 'u-2',
    closedByName: ANNA.name,
    closedAt: minutesAgo(30),
  },
  {
    ...base,
    id: 'ann-4',
    number: 4,
    shape: 'point',
    ...pt(120, 200),
    kind: 'defect',
    body: 'Fensterbrüstung Zimmer 1 unter 1,00 m.',
    revisionNumber: 2,
    onCurrentRevision: false,
    carryTarget: CARRY_HERE,
  },
  {
    ...base,
    id: 'ann-6',
    number: 6,
    shape: 'region',
    ...region(62, 278, 178, 312),
    kind: 'question',
    body: 'Gangbreite vor Zimmer 1: reicht 1,20 m nach dem Umbau der Wand?',
    createdBy: 'u-2',
    createdByName: ANNA.name,
    canDelete: false,
    revisionNumber: 2,
    onCurrentRevision: false,
    carryTarget: CARRY_HERE,
  },
  {
    ...base,
    id: 'ann-5',
    number: 5,
    shape: 'point',
    ...pt(640, 420),
    kind: 'question',
    authorKind: 'piloti',
    body: 'Gilt die Brüstungshöhe ab Fertigfußboden oder ab Rohdecke?',
    acceptedBy: 'u-1',
    acceptedByName: ME.name,
    assigneeUserId: 'u-1',
    assigneeName: ME.name,
    canDelete: false,
    createdAt: minutesAgo(25),
    updatedAt: minutesAgo(25),
  },
]
let nextNumber = 7

let unreadMarks = ['ann-1']

let indexB: AnnotationView[] = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('blank') ? [] : [
  {
    ...base,
    documentId: INDEX_B.id,
    id: 'ann-b2',
    number: 2,
    shape: 'point',
    ...pt(500, 200),
    kind: 'defect',
    body: 'Technikraum: Lüftungsquerschnitt fehlt in der Legende.',
    assigneeUserId: 'u-3',
    assigneeName: JAKOB.name,
    dueOn: '2026-10-24',
    revisionNumber: 2,
    carryTarget: CARRY_HERE,
  },
  {
    ...base,
    documentId: INDEX_B.id,
    id: 'ann-b3',
    number: 3,
    shape: 'region',
    ...region(330, 330, 450, 500),
    kind: 'question',
    body: 'Bad: ist die Vorwand bis zur Decke geführt?',
    createdBy: 'u-2',
    createdByName: ANNA.name,
    canDelete: false,
    revisionNumber: 2,
    carryTarget: CARRY_HERE,
  },
  {
    ...base,
    documentId: INDEX_B.id,
    id: 'ann-b1',
    number: 1,
    shape: 'point',
    ...pt(120, 420),
    kind: 'hint',
    body: 'Raumhöhe Wohnen 1 ergänzt.',
    status: 'resolved',
    closedBy: 'u-1',
    closedByName: ME.name,
    closedAt: minutesAgo(400),
    revisionNumber: 2,
  },
]

const AGENT_PROPOSALS: AnnotationView[] = [
  {
    ...base,
    id: 'ann-p1',
    number: 0,
    shape: 'region',
    ...region(50, 270, 570, 320),
    kind: 'question',
    body: 'Gang als Fluchtweg: lichte Breite ist nicht kotiert. Mindestens 1,20 m nachweisen.',
    basis: 'OIB-RL 4, Pkt. 2.2.1',
    authorKind: 'piloti',
    status: 'proposed',
    canDelete: false,
  },
  {
    ...base,
    id: 'ann-p2',
    number: 0,
    shape: 'point',
    ...pt(500, 333),
    kind: 'defect',
    body: 'Tür Technik in den Fluchtweg: Feuerwiderstand fehlt, Technikraum gilt als Raum mit erhöhter Brandgefahr.',
    basis: 'OIB-RL 2, Pkt. 3.4',
    authorKind: 'piloti',
    status: 'proposed',
    canDelete: false,
  },
  {
    ...base,
    id: 'ann-p3',
    number: 0,
    shape: 'region',
    ...region(90, 76, 150, 84),
    kind: 'hint',
    body: 'Belichtung Zimmer 1: Fensterfläche gegen 1/10 der Bodenfläche prüfen.',
    basis: 'OIB-RL 3, Pkt. 9.1.1',
    authorKind: 'piloti',
    status: 'proposed',
    canDelete: false,
  },
]

const CHANNEL = `doc:${FILE.id}`
type Listener = (frame: RealtimeFrame) => void
const sources = new Set<Listener>()
const broadcast = (event: RoomEvent) => sources.forEach((listener) => listener({ kind: 'event', ch: CHANNEL, event }))
const peer = (who: { userId: string; name: string }, peerId: string): RoomPeer => ({ ...who, peerId, kind: 'person' })
const annaPeer = peer(ANNA, 'peer-anna-0001')
const jakobPeer = peer(JAKOB, 'peer-jakob-001')
const lenaPeer = peer(LENA, 'peer-lena-0001')
const agentPeer: RoomPeer = { peerId: 'agent-dev-conv', userId: ME.userId, name: PRODUCT_NAME, kind: 'piloti' }

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
    actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: 'piloti' },
  })
}

const proposeFindings = () => {
  const fresh = AGENT_PROPOSALS.filter((proposal) => !annotations.some((annotation) => annotation.id === proposal.id))
  if (fresh.length === 0) return
  const proposed = fresh.map((proposal) => ({ ...proposal, number: nextNumber++, createdAt: new Date().toISOString() }))
  annotations = [...annotations, ...proposed]
  broadcast({
    kind: 'annotations.changed',
    annotationIds: proposed.map((proposal) => proposal.id),
    change: 'created',
    actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: 'piloti' },
  })
}

const jakobDraft = (s: number) => {
  const phase = s % 6
  if (phase > 3) return null
  const grow = Math.min(1, phase / 2.4)
  return { x: 0.558, y: 0.58, w: +(0.005 + 0.09 * grow).toFixed(4), h: +(0.005 + 0.23 * grow).toFixed(4) }
}

let started = false
function startRoom(withAgent: boolean) {
  if (started) return
  started = true
  const t0 = performance.now()
  const everyone = [annaPeer, jakobPeer, lenaPeer]
  for (const who of everyone) broadcast({ kind: 'presence', peer: who, state: 'here', ttlMs: 25_000 })
  setInterval(() => {
    for (const who of everyone) broadcast({ kind: 'presence', peer: who, state: 'here', ttlMs: 25_000 })
  }, 8_000)
  broadcast({ kind: 'viewport', peer: annaPeer, viewport: { page: 1, y: 0.45 }, selected: 'ann-1' })
  broadcast({ kind: 'viewport', peer: lenaPeer, viewport: { page: 2, y: 0.4 } })
  broadcast({ kind: 'cursor', peer: lenaPeer, tool: 'select', cursor: { page: 2, x: 0.42, y: 0.38 } })
  setInterval(() => {
    const s = (performance.now() - t0) / 1000
    const along = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(s * 0.55))
    broadcast({
      kind: 'cursor',
      peer: annaPeer,
      tool: 'select',
      cursor: { page: 1, x: along, y: 0.44 + 0.015 * Math.sin(s * 2.1) },
      chat: s % 12 > 7 ? 'Hier fehlt die Kote' : null,
    })
    const draft = jakobDraft(s)
    broadcast({
      kind: 'cursor',
      peer: jakobPeer,
      tool: 'region',
      cursor: draft
        ? { page: 1, x: draft.x + draft.w, y: draft.y + draft.h }
        : { page: 1, x: 0.62 + 0.03 * Math.cos(s * 0.9), y: 0.36 + 0.06 * Math.sin(s * 0.9) },
      draft,
    })
  }, 80)
  if (withAgent) {
    const piloti = agentPeer
    const corridor = { page: 1, ...region(50, 270, 570, 320) }
    broadcast({ kind: 'presence', peer: piloti, state: 'here', ttlMs: 25_000 })
    broadcast({ kind: 'activity', peer: piloti, state: 'reading', box: corridor, label: 'sieht sich den Gang an' })
    broadcast({ kind: 'cursor', peer: piloti, cursor: { page: 1, ...pt(300, 295) }, tool: 'select', label: 'Fluchtweg' })
    setTimeout(() => broadcast({ kind: 'highlight', peer: piloti, box: corridor, label: 'Breite nicht kotiert', ttlMs: 6_000 }), 900)
    setTimeout(() => broadcast({ kind: 'activity', peer: piloti, state: 'idle' }), 2400)
    setInterval(() => broadcast({ kind: 'presence', peer: piloti, state: 'here', ttlMs: 25_000 }), 8_000)
    setTimeout(proposeFindings, 2200)
  }
}

class RoomEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  private readonly listener: Listener = (frame) => this.onmessage?.({ data: JSON.stringify(frame) })
  constructor(readonly url: string) {
    setTimeout(() => {
      this.onopen?.()
      this.listener({ kind: 'welcome', self: { ...ME, kind: 'person' } })
      const channels = new URL(url, window.location.origin).searchParams.getAll('ch')
      if (!channels.includes(CHANNEL)) return
      sources.add(this.listener)
      startRoom(new URLSearchParams(window.location.search).has('piloti'))
    }, 50)
  }
  close() {
    sources.delete(this.listener)
  }
}

type Unenveloped<F> = F extends unknown ? Omit<F, 'v' | 'seq' | 'ts' | 'turn_id' | 'conversation_id'> : never
type WireBody = Unenveloped<z.input<typeof wireEventSchema>>

const ACCEPTS = ['user_message.focus_region', 'user_message.reply_in_thread', 'cancel_turn.shown']
const DELTA_MS = 120
const DELTAS = 10

interface FocusBox {
  page: number
  x: number
  y: number
  w: number
  h: number
  annotationId: string | null
}

interface ScriptedTurn {
  turnId: string
  conversationId: string
  messageId: string
  log: Record<string, unknown>[]
  socket: FakeTurnSocket | null
  timer: ReturnType<typeof setTimeout> | null
  text: string
  done: boolean
}

const turns = new Map<string, ScriptedTurn>()

const safely = (run: () => void) => {
  try {
    run()
  } catch (error) {
    console.warn('[dev/annotations] scripted turn', error)
  }
}

const CORRIDOR = region(50, 270, 570, 320)
const onCorridor = (box: FocusBox) => {
  const middle = box.y + box.h / 2
  return middle > CORRIDOR.y - 0.03 && middle < CORRIDOR.y + CORRIDOR.h + 0.03
}

const OIB_RL_4 = {
  content: 'Gänge im Verlauf von Fluchtwegen müssen eine lichte Breite von mindestens 1,20 m aufweisen.',
  file_name: 'OIB-Richtlinie 4 · Nutzungssicherheit und Barrierefreiheit',
  number: 1,
  page: 4,
}

const CORRIDOR_ANSWER =
  'Der Ausschnitt zeigt den Gang (Fluchtweg) zwischen Wohnen 1 und Zimmer 1. Die lichte Breite ist im Ausschnitt nicht kotiert; ' +
  'nach OIB-RL 4, Pkt. 2.2.1 braucht ein Fluchtweg hier mindestens 1,20 m [1]. Abgegriffen im Maßstab 1:100 sind es rund 1,75 m, ' +
  'das reicht. Die Kote sollte trotzdem in die Zeichnung, sonst ist der Nachweis nicht geführt.'
const BOX_ANSWER =
  'Der Ausschnitt zeigt einen Teil des Regelgeschosses im Maßstab 1:100. Maße sind darin nicht kotiert, deshalb lässt sich ' +
  'gegen OIB-RL 4 nichts nachweisen [1]. Mit einer Bemaßung im Ausschnitt prüfe ich Breiten und Durchgänge gern nach.'
const threadAnswer = (number: number) =>
  `Zu Anmerkung ${number}: Ich habe mir die Stelle angesehen. In dieser Fassung ist dazu noch nichts eingetragen; ` +
  'ich würde die Angabe mit der nächsten Fassung nachfordern und die Anmerkung bis dahin offen lassen.'
const REVIEW_ANSWER =
  'Ich habe den Grundriss durchgesehen und drei Vorschläge gesetzt: die nicht kotierte Breite des Gangs (Fluchtweg), ' +
  'den fehlenden Feuerwiderstand der Tür zum Technikraum und die Belichtung von Zimmer 1. ' +
  'Sie stehen als Vorschläge in der Liste; übernehmen oder verwerfen Sie sie dort.'

const deltasOf = (text: string): string[] => {
  const words = text.split(/(?<= )/)
  const size = Math.ceil(words.length / DELTAS)
  return Array.from({ length: Math.ceil(words.length / size) }, (_, index) => words.slice(index * size, (index + 1) * size).join(''))
}

const emit = (turn: ScriptedTurn, body: WireBody) => {
  const frame = { v: 2, conversation_id: turn.conversationId, turn_id: turn.turnId, seq: turn.log.length + 1, ts: Date.now(), ...body }
  turn.log.push(frame)
  turn.socket?.deliver(frame)
}

const play = (turn: ScriptedTurn, steps: ReadonlyArray<readonly [after: number, run: () => void]>, index = 0) => {
  const step = steps[index]
  if (!step) return
  turn.timer = setTimeout(() => {
    if (turn.done) return
    safely(step[1])
    play(turn, steps, index + 1)
  }, step[0])
}

const streamAnswer = (turn: ScriptedTurn, text: string): Array<readonly [number, () => void]> => [
  [400, () => emit(turn, { type: 'TEXT_MESSAGE_START', message_id: turn.messageId })],
  ...deltasOf(text).map(
    (delta) =>
      [
        DELTA_MS,
        () => {
          turn.text += delta
          emit(turn, { type: 'TEXT_MESSAGE_CONTENT', message_id: turn.messageId, delta })
        },
      ] as const
  ),
  [DELTA_MS, () => emit(turn, { type: 'TEXT_MESSAGE_END', message_id: turn.messageId })],
]

const finish = (turn: ScriptedTurn, text: string, sources: (typeof OIB_RL_4)[]) => {
  emit(turn, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: turn.messageId, text, sources } })
  turn.done = true
  broadcast({ kind: 'activity', peer: agentPeer, state: 'idle' })
}

const synthesis = { id: 'step-synthesis', kind: 'status', slot: 'synthesis', key: 'status.synthesis' } as const

const answerAboutBox = (turn: ScriptedTurn, box: FocusBox, replyInThread: boolean) => {
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
            actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: 'piloti' },
          })
        }
        finish(turn, text, thread ? [] : [OIB_RL_4])
      },
    ],
  ])
}

const reviewDocument = (turn: ScriptedTurn) => {
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

const FIXED_VERDICTS: Record<string, string> = {
  'ann-4': 'Weiterhin offen: Die Brüstung in Zimmer 1 ist in Fassung 3 weiter mit 0,90 m kotiert.',
  'ann-b2': 'In Grundriss_RG_Index-C behoben: Die Legende nennt jetzt den Lüftungsquerschnitt des Technikraums (0,04 m²).',
  'ann-b3': 'Weiterhin offen: Im Bad ist die Vorwand nur bis 1,20 m dargestellt; ein Schnitt dazu fehlt.',
}

const checkFixed = (turn: ScriptedTurn, question: string) => {
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
            actor: { peerId: null, userId: ME.userId, name: PRODUCT_NAME, kind: 'piloti' },
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

const protocolPdf = () =>
  buildPdf([
    [
      ['Anmerkungen – Grundriss_RG_Index-C', 16, true],
      ['Fassung 3 von 3 · Wohnbau Nord — Linz', 10, false],
      ['Nr. 1 · Seite 1 · Mangel · offen', 10, true],
      ['Tür von Wohnen 2 in den Fluchtweg ohne Angabe der Feuerwiderstandsklasse.', 10, false],
    ],
  ])

const filed = new Map<string, { id: string; versions: number }>()

const stopTurn = (turn: ScriptedTurn) => {
  if (turn.timer) clearTimeout(turn.timer)
  turn.timer = null
  if (turn.done) return
  emit(turn, { type: 'RUN_FINISHED', outcome: 'cancelled', result: { message_id: turn.messageId, text: turn.text } })
  turn.done = true
  broadcast({ kind: 'activity', peer: agentPeer, state: 'idle' })
}

const stringOf = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

const focusOf = (raw: unknown): FocusBox | null => {
  if (!raw || typeof raw !== 'object') return null
  const { page, x, y, w, h, annotation_id: annotationId } = raw as Record<string, unknown>
  const numbers = [page, x, y, w, h]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  const [p, bx, by, bw, bh] = numbers as number[]
  return { page: p, x: bx, y: by, w: bw, h: bh, annotationId: stringOf(annotationId) }
}

type RejectedCode = 'duplicate_turn' | 'turn_not_found' | 'invalid_message' | 'no_pending_interaction'
type RejectedOf = 'user_message' | 'interaction_response' | 'cancel_turn' | 'attach' | 'unknown'

class FakeTurnSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(readonly url: string) {
    setTimeout(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.(new Event('open'))
      this.deliver({ type: 'CUSTOM', name: 'hello', v: 2, ts: Date.now(), value: { build: 'dev-annotations', accepts: ACCEPTS } })
    }, 40)
  }

  deliver(frame: unknown) {
    setTimeout(() => {
      if (this.readyState === 1) safely(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) })))
    }, 0)
  }

  send(data: unknown) {
    safely(() => this.receive(String(data)))
  }

  close(code = 1000) {
    if (this.readyState >= 2) return
    this.readyState = 3
    for (const turn of turns.values()) if (turn.socket === this) turn.socket = null
    setTimeout(() => safely(() => this.onclose?.(new CloseEvent('close', { code, wasClean: true }))), 0)
  }

  addEventListener() {}
  removeEventListener() {}

  private reject(code: RejectedCode, of: RejectedOf, ids: { conversation_id?: unknown; turn_id?: unknown }) {
    this.deliver({
      type: 'CUSTOM',
      name: 'rejected',
      v: 2,
      seq: 0,
      ts: Date.now(),
      conversation_id: stringOf(ids.conversation_id) ?? 'unknown',
      turn_id: stringOf(ids.turn_id) ?? 'unknown',
      value: { code, of, message: null },
    })
  }

  private receive(data: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data) as Record<string, unknown>
    } catch {
      return this.reject('invalid_message', 'unknown', {})
    }
    switch (message.type) {
      case 'user_message':
        return this.ask(message)
      case 'attach':
        return this.attach(message)
      case 'cancel_turn': {
        const turn = turns.get(String(message.turn_id))
        return turn ? stopTurn(turn) : this.reject('turn_not_found', 'cancel_turn', message)
      }
      case 'interaction_response':
        return this.reject('no_pending_interaction', 'interaction_response', message)
      default:
        return this.reject('invalid_message', 'unknown', message)
    }
  }

  private ask(message: Record<string, unknown>) {
    const turnId = stringOf(message.message_id)
    const conversationId = stringOf(message.conversation_id)
    if (!turnId || !conversationId || !stringOf(message.text)) return this.reject('invalid_message', 'user_message', message)
    if (turns.has(turnId)) return this.reject('duplicate_turn', 'user_message', message)
    const turn: ScriptedTurn = {
      turnId,
      conversationId,
      messageId: `${turnId}-answer`,
      log: [],
      socket: this,
      timer: null,
      text: '',
      done: false,
    }
    turns.set(turnId, turn)
    const box = focusOf(message.focus_region)
    const text = stringOf(message.text) ?? ''
    if (box) answerAboutBox(turn, box, message.reply_in_thread === true)
    else if (/behoben|fixed/.test(text)) checkFixed(turn, text)
    else reviewDocument(turn)
  }

  private attach(message: Record<string, unknown>) {
    const turn = turns.get(String(message.turn_id))
    if (!turn) return this.reject('turn_not_found', 'attach', message)
    turn.socket = this
    const after = typeof message.after_seq === 'number' ? message.after_seq : 0
    for (const frame of turn.log) if (Number(frame.seq) > after) this.deliver(frame)
  }
}

const isTurnSocket = (url: string | URL) => {
  try {
    return new URL(String(url), window.location.href).pathname === '/websocket'
  } catch {
    return false
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __annotationsShim?: boolean; EventSource: unknown }
  if (!w.__annotationsShim) {
    w.__annotationsShim = true
    w.EventSource = RoomEventSource
    window.WebSocket = new Proxy(window.WebSocket, {
      construct: (target, args: ConstructorParameters<typeof WebSocket>) =>
        isTurnSocket(args[0]) ? new FakeTurnSocket(String(args[0])) : Reflect.construct(target, args),
    })
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
            (one) => one.targetId !== 'agent:piloti' || (target.mentions ?? []).some((had) => had.targetId === 'agent:piloti')
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
        const answersAgent = current.authorKind === 'piloti' && current.kind === 'question' && current.status !== 'resolved' && current.status !== 'dismissed'
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
          ...(moved && status === 'open' && current.authorKind === 'piloti' && !current.acceptedBy
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
  }
}

export default function AnnotationsPreview(): JSX.Element {
  return (
    <main className="bg-muted/40 flex min-h-dvh items-center justify-center">
      <div className="bg-popover text-popover-foreground h-[85dvh] w-[min(1100px,calc(100%-2rem))] overflow-hidden rounded-2xl border shadow-lg phone:fixed phone:inset-0 phone:h-dvh phone:w-full phone:rounded-none phone:border-0">
        <FilePreviewPane
          file={FILE}
          projectId="proj-demo"
          projectName="Wohnbau Nord — Linz"
          canManage
          canCollaborate
          viewerUserId="u-1"
          onClose={() => {}}
        />
      </div>
    </main>
  )
}

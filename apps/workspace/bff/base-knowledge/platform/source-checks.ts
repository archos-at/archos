import 'server-only'
import { isCapturedResponse, sourceConfigOf } from '@/lib/base-knowledge/wire/source'
import { CaptureFetchError, callPublicSources, refusalDetail } from './capture-fetch'
import { isCut, isPdf, type RecordingCapture, recordingCapturesOf } from './captures'
import { recordIdOf } from './records'
import { platformTransaction } from './store'
import { kitProblem, type Problem } from './validate'
import type { ProposedRecord } from './wire'

export interface SourceCheck {
  valid: boolean
  problems: { fixture: string | null; detail: string }[]
  fixtures: { name: string; ok: boolean; requested: string[]; awaiting?: string[] }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function checkOf(body: unknown): SourceCheck | null {
  if (!isRecord(body) || typeof body.valid !== 'boolean' || !Array.isArray(body.problems) || !Array.isArray(body.fixtures)) return null
  return body as unknown as SourceCheck
}

export async function checkSourceConfig(config: Record<string, unknown>): Promise<SourceCheck> {
  const answer = await callPublicSources('/v1/public-sources/check', { config })
  const check = answer.status === 200 ? checkOf(answer.body) : null
  if (!check) throw new CaptureFetchError(`The source check did not answer: ${refusalDetail(answer)}`, 502)
  return check
}

export interface BuiltInSource {
  sourceKey: string
  title: string
  territory: string
  protocol: string
  format: string
  hosts: string[]
  dataFlow: 'public_only' | 'site_keyed'
  licence: string
  monitor: { kind: string; intervalHours: number }
  credentialHeader: string | null
  fixtures: SourceCheck
}

export const BUILT_IN_TIMEOUT_MS = 5_000

export async function builtInSources(): Promise<BuiltInSource[]> {
  const answer = await callPublicSources('/v1/public-sources/built-in', {}, BUILT_IN_TIMEOUT_MS)
  if (answer.status === 200 && isRecord(answer.body) && Array.isArray(answer.body.sources)) {
    return answer.body.sources.filter((source): source is BuiltInSource => isRecord(source) && checkOf(source.fixtures) !== null)
  }
  throw new CaptureFetchError(`The built-in sources did not answer: ${refusalDetail(answer)}`, 502)
}

type SourceRecord = Extract<ProposedRecord, { type: 'source' }>

export interface Recording {
  contentType: string
  text: string
}

export function withRecordings(config: Record<string, unknown>, recordings: ReadonlyMap<string, Recording>): Record<string, unknown> {
  if (!Array.isArray(config.fixtures) || recordings.size === 0) return config
  const handedOver = (response: unknown) => {
    const recording = isRecord(response) && typeof response.capture_id === 'string' ? recordings.get(response.capture_id.toLowerCase()) : undefined
    return recording ? { ...(response as object), content_type: recording.contentType, text: recording.text } : response
  }
  const fixtures = config.fixtures.map((fixture: unknown) =>
    isRecord(fixture) && isRecord(fixture.responses)
      ? { ...fixture, responses: Object.fromEntries(Object.entries(fixture.responses).map(([url, response]) => [url, handedOver(response)])) }
      : fixture,
  )
  return { ...config, fixtures }
}

function namedCaptureIds(config: Record<string, unknown>): string[] {
  const fixtures = Array.isArray(config.fixtures) ? config.fixtures : []
  return fixtures.flatMap((fixture: unknown) =>
    isRecord(fixture) && isRecord(fixture.responses)
      ? Object.values(fixture.responses).flatMap((response) => (isRecord(response) && typeof response.capture_id === 'string' ? [response.capture_id] : []))
      : [],
  )
}

const usable = (capture: RecordingCapture): capture is RecordingCapture & { text: string } =>
  capture.basis === 'fetched' && capture.text !== null && isPdf(capture.contentType) && !isCut(capture.note)

export async function recordedConfig(config: Record<string, unknown>, changeRequestId: string | null): Promise<Record<string, unknown>> {
  const ids = namedCaptureIds(config)
  if (ids.length === 0) return config
  const captures = await platformTransaction((tx) => recordingCapturesOf(tx, changeRequestId, ids))
  const recordings = new Map<string, Recording>()
  for (const [id, capture] of captures) if (usable(capture)) recordings.set(id, { contentType: capture.contentType ?? '', text: capture.text })
  return withRecordings(config, recordings)
}

const pointerToken = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')

const CAPTURE_HINT = (record: SourceRecord, url: string) =>
  `Capture it with platform-knowledge-citation-capture {basis: "fetched", sourceId: "${record.key}", url: "${url}"} in this ` +
  'change request (the source must be proposed in it first, which opens its hosts to this request for 24 hours), then ' +
  'propose the record again with the answer’s captureId in this response.'

function refusedRecording(record: SourceRecord, url: string, captureId: string, capture: RecordingCapture | undefined): string | null {
  if (!capture) return `names capture ${captureId}, which is no capture of this change request.`
  if (capture.basis !== 'fetched') return `names capture ${captureId}, a text an operator supplied: a fixture is what the platform fetched itself.`
  if (capture.sourceId !== record.key) return `names capture ${captureId}, fetched through source ${capture.sourceId}, not through ${record.key}.`
  if (capture.url !== url) return `names capture ${captureId}, which is a capture of ${capture.url}, not of ${url}.`
  if (capture.text === null) return `names capture ${captureId}, which kept no text${capture.note ? ` (${capture.note})` : ''}: nothing in it proves the engine.`
  if (!isPdf(capture.contentType)) return `names capture ${captureId}, which is ${capture.contentType ?? 'of no known content type'}, not a PDF: a PDF fixture is proven by a capture of the PDF itself.`
  if (isCut(capture.note)) return `names capture ${captureId}, whose text was cut at a page boundary (${capture.note}): it proves only a prefix of the document.`
  return null
}

interface Recordings {
  recordings: Map<string, Recording>
  problems: Problem[]
  awaiting: string[]
}

async function recordingsOf(record: SourceRecord, changeRequestId: string | null, draft: boolean): Promise<Recordings> {
  const named = record.fixtures.flatMap((fixture, index) =>
    Object.entries(fixture.responses).flatMap(([url, response]) => (isCapturedResponse(response) ? [{ index, fixture: fixture.name, url, captureId: response.captureId }] : [])),
  )
  const found: Recordings = { recordings: new Map(), problems: [], awaiting: [] }
  if (named.length === 0) return found
  const ids = named.flatMap((one) => (one.captureId ? [one.captureId] : []))
  const captures = changeRequestId && ids.length > 0 ? await platformTransaction((tx) => recordingCapturesOf(tx, changeRequestId, ids)) : new Map<string, RecordingCapture>()
  for (const one of named) {
    const pointer = `/fixtures/${one.index}/responses/${pointerToken(one.url)}/captureId`
    if (one.captureId === null) {
      const waits = `fixture ${one.fixture} awaits its capture of ${one.url}.`
      if (draft) found.awaiting.push(`${waits} ${CAPTURE_HINT(record, one.url)}`)
      else found.problems.push(kitProblem('KC-7', record, pointer, waits, CAPTURE_HINT(record, one.url)))
      continue
    }
    const capture = captures.get(one.captureId.toLowerCase())
    const refused = refusedRecording(record, one.url, one.captureId, capture)
    if (refused) found.problems.push(kitProblem('KC-7', record, pointer, `fixture ${one.fixture} ${refused}`, CAPTURE_HINT(record, one.url)))
    else if (capture?.text != null) found.recordings.set(one.captureId.toLowerCase(), { contentType: capture.contentType ?? '', text: capture.text })
  }
  return found
}

async function checkedSource(record: SourceRecord, changeRequestId: string | null, draft: boolean): Promise<{ problems: Problem[]; awaiting: string[] }> {
  const { recordings, problems, awaiting } = await recordingsOf(record, changeRequestId, draft)
  try {
    const check = await checkSourceConfig(withRecordings(sourceConfigOf(record), recordings))
    const found = check.problems.map((problem) => {
      const index = problem.fixture ? record.fixtures.findIndex((fixture) => fixture.name === problem.fixture) : -1
      return kitProblem('KC-7', record, index >= 0 ? `/fixtures/${index}` : '', problem.detail)
    })
    return { problems: [...problems, ...found], awaiting }
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    return { problems: [...problems, kitProblem('KC-7', record, '', `could not be checked: ${error.message} Try again.`)], awaiting }
  }
}

export interface SourceChecks {
  checks: Map<string, Problem[]>
  awaiting: Map<string, string[]>
}

export async function sourceChecksOf(records: readonly ProposedRecord[], changeRequestId: string | null = null, draft = false): Promise<SourceChecks> {
  const sources = records.filter((record): record is SourceRecord => record.type === 'source')
  const checked = await Promise.all(sources.map(async (record) => [recordIdOf(record), await checkedSource(record, changeRequestId, draft)] as const))
  return {
    checks: new Map(checked.map(([id, answer]) => [id, answer.problems])),
    awaiting: new Map(checked.flatMap(([id, answer]) => (answer.awaiting.length > 0 ? [[id, answer.awaiting] as const] : []))),
  }
}

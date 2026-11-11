/**
 * KC-7 (ADR-0174): a proposed source record parses as its access type and
 * engine read it, its hosts cover every URL it names, and each recorded fixture
 * passes, with no live call. `packages/public-sources` holds the one validator
 * (`Source`, the access types, the engines, the fixture runner), so the kit
 * asks the api tier (`POST /v1/public-sources/check`) rather than keeping a
 * second copy here.
 *
 * Run before the kit's transaction, never inside it: a check is seconds, and a
 * request's lock must not wait on another tier. Unknown fails closed: an api
 * tier that cannot answer is a KC-7 problem on every source it did not check.
 *
 * **A fixture's response may be a capture the platform took** (ADR-0174,
 * amendment 2026-11-11): the record names a citation capture by id, and this
 * module hands the capture's content type and text to the check, so nobody
 * pastes a document's bytes. The capture must be a `fetched` one of the same
 * change request, of that very URL, through this source, and must have kept
 * text. A fixture that names no capture yet (`captureId: null`) awaits it: a
 * proposal into a draft is written all the same, because the source's hosts
 * open to its request only once it is proposed and the capture is fetched
 * through them; validate and submit hold it as a KC-7 problem.
 */

import 'server-only'
import { isCapturedResponse, sourceConfigOf } from '@/lib/base-knowledge/wire/source'
import { CaptureFetchError, callPublicSources, refusalDetail } from './capture-fetch'
import { type RecordingCapture, recordingCapturesOf } from './captures'
import { recordIdOf } from './records'
import { platformTransaction } from './store'
import { kitProblem, type Problem } from './validate'
import type { ProposedRecord } from './wire'

/** What the api tier's check answers. */
export interface SourceCheck {
  valid: boolean
  problems: { fixture: string | null; detail: string }[]
  /** `awaiting`: the URLs whose capture is not recorded; such a fixture was not run and is not `ok`. */
  fixtures: { name: string; ok: boolean; requested: string[]; awaiting?: string[] }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function checkOf(body: unknown): SourceCheck | null {
  if (!isRecord(body) || typeof body.valid !== 'boolean' || !Array.isArray(body.problems) || !Array.isArray(body.fixtures)) return null
  return body as unknown as SourceCheck
}

/** Run one configuration's check; throws {@link CaptureFetchError} when the api tier cannot answer. */
export async function checkSourceConfig(config: Record<string, unknown>): Promise<SourceCheck> {
  const answer = await callPublicSources('/v1/public-sources/check', { config })
  const check = answer.status === 200 ? checkOf(answer.body) : null
  if (!check) throw new CaptureFetchError(`The source check did not answer: ${refusalDetail(answer)}`, 502)
  return check
}

/**
 * A built-in source: one of the repository's own (`configs/sources`), an engine's configuration the agent's tools
 * read and that is reviewed as code, never a platform record (ADR-0174, "Which kind a source is").
 */
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
  /** Its recorded fixtures, run once per api-tier process: the check KC-7 runs on a record. */
  fixtures: SourceCheck
}

/** How long source-status waits for the built-in list before it lists the records alone: it is read once per process. */
export const BUILT_IN_TIMEOUT_MS = 5_000

/** The built-in sources as the api tier lists them; throws {@link CaptureFetchError} when it cannot answer. */
export async function builtInSources(): Promise<BuiltInSource[]> {
  const answer = await callPublicSources('/v1/public-sources/built-in', {}, BUILT_IN_TIMEOUT_MS)
  if (answer.status === 200 && isRecord(answer.body) && Array.isArray(answer.body.sources)) {
    return answer.body.sources.filter((source): source is BuiltInSource => isRecord(source) && checkOf(source.fixtures) !== null)
  }
  throw new CaptureFetchError(`The built-in sources did not answer: ${refusalDetail(answer)}`, 502)
}

type SourceRecord = Extract<ProposedRecord, { type: 'source' }>

/** A capture's content type and text, as the check reads a fixture's recording. */
export interface Recording {
  contentType: string
  text: string
}

/**
 * `config` (as `sourceConfigOf` writes it and a revision keeps it) with each capture a fixture names handed over:
 * its content type and text beside its id. A capture not in `recordings` stays an id, and its fixture is not run.
 */
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

/** The capture ids a stored configuration's fixtures name. */
function namedCaptureIds(config: Record<string, unknown>): string[] {
  const fixtures = Array.isArray(config.fixtures) ? config.fixtures : []
  return fixtures.flatMap((fixture: unknown) =>
    isRecord(fixture) && isRecord(fixture.responses)
      ? Object.values(fixture.responses).flatMap((response) => (isRecord(response) && typeof response.capture_id === 'string' ? [response.capture_id] : []))
      : [],
  )
}

const usable = (capture: RecordingCapture): capture is RecordingCapture & { text: string } => capture.basis === 'fetched' && capture.text !== null

/**
 * A stored source's configuration with its fixtures' recordings, for `source-test`: the captures its revision names,
 * of `changeRequestId` for a source under test, wherever they are for a published one (its request validated them,
 * and a capture never changes). A capture that is gone or kept no text leaves its fixture awaiting, never passing.
 */
export async function recordedConfig(config: Record<string, unknown>, changeRequestId: string | null): Promise<Record<string, unknown>> {
  const ids = namedCaptureIds(config)
  if (ids.length === 0) return config
  const captures = await platformTransaction((tx) => recordingCapturesOf(tx, changeRequestId, ids))
  const recordings = new Map<string, Recording>()
  for (const [id, capture] of captures) if (usable(capture)) recordings.set(id, { contentType: capture.contentType ?? '', text: capture.text })
  return withRecordings(config, recordings)
}

/** RFC 6901: a URL as one reference token of a JSON Pointer. */
const pointerToken = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')

const CAPTURE_HINT = (record: SourceRecord, url: string) =>
  `Capture it with platform-knowledge-citation-capture {basis: "fetched", sourceId: "${record.key}", url: "${url}"} in this ` +
  'change request (the source must be proposed in it first, which opens its hosts to this request for 24 hours), then ' +
  'propose the record again with the answer’s captureId in this response.'

/** Why `capture` cannot be the recording of `url` for `record`, or null when it can. */
function refusedRecording(record: SourceRecord, url: string, captureId: string, capture: RecordingCapture | undefined): string | null {
  if (!capture) return `names capture ${captureId}, which is no capture of this change request.`
  if (capture.basis !== 'fetched') return `names capture ${captureId}, a text an operator supplied: a fixture is what the platform fetched itself.`
  if (capture.sourceId !== record.key) return `names capture ${captureId}, fetched through source ${capture.sourceId}, not through ${record.key}.`
  if (capture.url !== url) return `names capture ${captureId}, which is a capture of ${capture.url}, not of ${url}.`
  if (capture.text === null) return `names capture ${captureId}, which kept no text${capture.note ? ` (${capture.note})` : ''}: nothing in it proves the engine.`
  return null
}

interface Recordings {
  recordings: Map<string, Recording>
  problems: Problem[]
  /** What still waits for its capture, in words: a draft's proposal is written with these open. */
  awaiting: string[]
}

/**
 * The recordings `record`'s fixtures name, each held to its URL, its source and this request, and what is wrong
 * with the rest. `draft` is a proposal: a response that names no capture yet waits (no problem) instead of failing.
 */
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
    // A fixture whose capture is missing or refused is not run by the check; what is wrong with it is said above.
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

/** KC-7's answer for a batch: each source's problems, and what each still waits for, by record id. */
export interface SourceChecks {
  checks: Map<string, Problem[]>
  awaiting: Map<string, string[]>
}

/**
 * KC-7 for every source record of `records`, by record id: what `validateProposal` takes as `sourceChecks`.
 * `changeRequestId` is the request whose captures a fixture may name; `draft` a proposal into it, which may still
 * await a capture (see the module comment).
 */
export async function sourceChecksOf(records: readonly ProposedRecord[], changeRequestId: string | null = null, draft = false): Promise<SourceChecks> {
  const sources = records.filter((record): record is SourceRecord => record.type === 'source')
  const checked = await Promise.all(sources.map(async (record) => [recordIdOf(record), await checkedSource(record, changeRequestId, draft)] as const))
  return {
    checks: new Map(checked.map(([id, answer]) => [id, answer.problems])),
    awaiting: new Map(checked.flatMap(([id, answer]) => (answer.awaiting.length > 0 ? [[id, answer.awaiting] as const] : []))),
  }
}

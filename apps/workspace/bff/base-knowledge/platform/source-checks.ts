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
 */

import 'server-only'
import { sourceConfigOf } from '@/lib/base-knowledge/wire/source'
import { CaptureFetchError, callPublicSources, refusalDetail } from './capture-fetch'
import { recordIdOf } from './records'
import { kitProblem, type Problem } from './validate'
import type { ProposedRecord } from './wire'

/** What the api tier's check answers. */
export interface SourceCheck {
  valid: boolean
  problems: { fixture: string | null; detail: string }[]
  fixtures: { name: string; ok: boolean; requested: string[] }[]
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

type SourceRecord = Extract<ProposedRecord, { type: 'source' }>

async function problemsOf(record: SourceRecord): Promise<Problem[]> {
  try {
    const check = await checkSourceConfig(sourceConfigOf(record))
    return check.problems.map((found) => {
      const index = found.fixture ? record.fixtures.findIndex((fixture) => fixture.name === found.fixture) : -1
      return kitProblem('KC-7', record, index >= 0 ? `/fixtures/${index}` : '', found.detail)
    })
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    return [kitProblem('KC-7', record, '', `could not be checked: ${error.message} Try again.`)]
  }
}

/** KC-7 for every source record of `records`, by record id: what `validateProposal` takes as `sourceChecks`. */
export async function sourceChecksOf(records: readonly ProposedRecord[]): Promise<Map<string, Problem[]>> {
  const sources = records.filter((record): record is SourceRecord => record.type === 'source')
  const checked = await Promise.all(sources.map(async (record) => [recordIdOf(record), await problemsOf(record)] as const))
  return new Map(checked)
}

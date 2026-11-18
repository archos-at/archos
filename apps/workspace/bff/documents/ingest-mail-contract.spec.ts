/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mailOriginIngestFactsSchema,
  mailThreadIngestFactsSchema,
} from '@/lib/mail-thread/ingest-facts'
import { SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { MAIL_THREAD_LOCALES } from '@/lib/mail-thread/mail-thread-vocabulary'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const read = (...path: string[]): string => readFileSync(join(REPO_ROOT, ...path), 'utf8')

const SERVICE = read('apps', 'workspace', 'bff', 'documents', 'ingest-dispatch.ts')
const REQUESTS = [
  read('apps', 'agent-host', 'src', 'agent_host', 'models', 'mail_facts.py'),
  read('apps', 'agent-host', 'src', 'agent_host', 'models', 'requests.py'),
].join('\n')

const pythonClass = (name: string): string => {
  const body = new RegExp(`^class ${name}\\([A-Za-z, ]+\\):\\n([\\s\\S]*?)(?=^\\S)`, 'm').exec(
    REQUESTS
  )
  expect(body, `class ${name} not found in the request models`).not.toBeNull()
  return body![1]!
}

const fieldsOf = (name: string): string[] =>
  [...pythonClass(name).matchAll(/^ {4}([a-z_]+): /gm)]
    .map((match) => match[1]!)
    .filter((field) => field !== 'model_config')

const literal = (alias: string): string[] => {
  const found = new RegExp(`^${alias} = Literal\\[([^\\]]+)\\]`, 'm').exec(REQUESTS)
  expect(found, `${alias} not found in the request models`).not.toBeNull()
  return [...found![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
}

const sentKey = (field: string): string => {
  const sent = new RegExp(`\\{\\s*(\\w+):\\s*extras\\.${field}\\s*\\}`).exec(SERVICE)
  expect(sent, `dispatchIngest no longer sends extras.${field}`).not.toBeNull()
  return sent![1]!
}

describe('ingest mail contract', () => {
  it('sends each record under the key IngestRequest declares for it', () => {
    const request = pythonClass('IngestRequest')
    expect(request).toMatch(
      new RegExp(`^ {4}${sentKey('mailThread')}: MailThreadFacts \\| None = Field\\(`, 'm')
    )
    expect(request).toMatch(
      new RegExp(`^ {4}${sentKey('mailOrigin')}: MailOrigin \\| None = Field\\(`, 'm')
    )
  })

  it('writes exactly the fields each forbid-extra model declares', () => {
    expect(pythonClass('MailThreadFacts')).toMatch(/extra="forbid"/)
    expect(pythonClass('MailOrigin')).toMatch(/extra="forbid"/)
    expect(Object.keys(mailThreadIngestFactsSchema.shape).sort()).toEqual(
      fieldsOf('MailThreadFacts').sort()
    )
    expect(Object.keys(mailOriginIngestFactsSchema.shape).sort()).toEqual(
      fieldsOf('MailOrigin').sort()
    )
  })

  it('names the trusts and locales the backend accepts, and no other', () => {
    expect([...SENDER_TRUSTS].sort()).toEqual(literal('SenderTrust').sort())
    expect([...MAIL_THREAD_LOCALES].sort()).toEqual(literal('MailLocale').sort())
  })

  it('never sends both records on one document, which the backend refuses', () => {
    expect(pythonClass('IngestRequest')).toMatch(
      /mail_thread is not None and self\.mail_origin is not None/
    )
    expect(SERVICE).toMatch(/extras\.mailOrigin && !extras\.mailThread/)
  })
})

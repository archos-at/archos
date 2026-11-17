// @disk-inputs: ../agent-host/src/agent_host/models/requests.py
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INGEST_PRIORITIES } from './ingest-dispatch'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const REQUESTS = join(REPO_ROOT, 'apps', 'agent-host', 'src', 'agent_host', 'models', 'requests.py')

const backendPriorities = (): string[] => {
  const source = readFileSync(REQUESTS, 'utf8')
  const literal = /priority:\s*Literal\[([^\]]*)\]/.exec(source)
  expect(literal, 'IngestRequest.priority Literal not found in requests.py').not.toBeNull()
  return Array.from(literal![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]!)
}

describe('ingest priority contract', () => {
  it('sends exactly the priorities POST /v1/ingest accepts', () => {
    expect([...INGEST_PRIORITIES].sort()).toEqual(backendPriorities().sort())
  })
})

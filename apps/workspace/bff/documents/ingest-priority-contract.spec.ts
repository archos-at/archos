/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import * as agentHost from '@/lib/agent-host-contract.generated'
import { INGEST_PRIORITIES } from './ingest-dispatch'

describe('ingest priority contract', () => {
  it('sends exactly the priorities POST /v1/ingest accepts', () => {
    expect([...INGEST_PRIORITIES].sort()).toEqual([...agentHost.INGEST_PRIORITIES].sort())
  })
})

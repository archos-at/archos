import { describe, expect, it } from 'vitest'
import { HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { shelfGet } from '@/test-utils/shelf-handlers'
import { listShelfCandidates } from './base-knowledge-client'

describe('listShelfCandidates', () => {
  it('offers a file already filed under the standards folder, which the Büroablage lists only when asked', async () => {
    server.use(
      shelfGet('office_shelf', '/api/documents', ({ request }) =>
        HttpResponse.json({
          documents:
            new URL(request.url).searchParams.get('includeStandards') === 'true'
              ? [{ id: 'a1', filename: 'Detail.pdf' }, { id: 'n1', filename: 'Brandschutz-Richtlinie.pdf' }]
              : [{ id: 'a1', filename: 'Detail.pdf' }],
        })
      )
    )

    expect(await listShelfCandidates()).toEqual([
      { id: 'a1', name: 'Detail.pdf' },
      { id: 'n1', name: 'Brandschutz-Richtlinie.pdf' },
    ])
  })
})

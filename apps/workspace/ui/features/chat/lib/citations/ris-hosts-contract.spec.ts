// @disk-inputs: ../../configs/sources/at/ris/source.yml
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RIS_DOCUMENT_HOSTS, isRisUrl } from './target'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const RECORD = join(REPO_ROOT, 'configs', 'sources', 'at', 'ris', 'source.yml')

const backendHosts = (): string[] => {
  const source = readFileSync(RECORD, 'utf8')
  const block = /^hosts:\n((?:[ \t]+-[ \t]+\S+\n)+)/m.exec(source)
  expect(block, 'hosts not found in the RIS source record').not.toBeNull()
  return Array.from(block![1].matchAll(/-[ \t]+(\S+)/g)).map((m) => m[1]!)
}

describe('RIS reader host contract', () => {
  it('offers the reader for exactly the hosts the backend will fetch', () => {
    const hosts = backendHosts()
    expect(hosts.length).toBeGreaterThan(0)
    for (const host of hosts) {
      expect(isRisUrl(`https://${host}/Dokumente/Bundesnormen/NOR40217157/NOR40217157.html`)).toBe(
        true
      )
    }
    expect(new Set(RIS_DOCUMENT_HOSTS)).toEqual(new Set(hosts))
  })

  it('refuses anything else, however RIS-shaped', () => {
    expect(isRisUrl('https://ris.bka.gv.at.evil.example/Dokument.wxe')).toBe(false)
    expect(isRisUrl('https://example.org/ris.bka.gv.at')).toBe(false)
    expect(isRisUrl('http://www.ris.bka.gv.at/Dokument.wxe')).toBe(false)
    expect(isRisUrl(undefined)).toBe(false)
    expect(isRisUrl('not a url')).toBe(false)
  })
})

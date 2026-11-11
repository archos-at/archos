// @disk-inputs: ../../contracts/public-site.json
/**
 * @vitest-environment node
 *
 * The website pages the app links to are held to `contracts/public-site.json`,
 * which the website's own test holds to its route table, and the origin rule
 * the help links share with the bounce text.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_SITE_ANCHORS, PUBLIC_SITE_ORIGIN_MAX_LENGTH, PUBLIC_SITE_PATHS, publicSiteLink, publicSiteOrigin } from './public-site'

const CONTRACT = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'contracts', 'public-site.json'), 'utf8')) as {
  paths: Record<string, Record<string, string>>
  anchors: Record<string, string[]>
}

describe('the public site pages (contracts/public-site.json)', () => {
  it('names the same pages at the same paths', () => {
    expect(PUBLIC_SITE_PATHS).toEqual(CONTRACT.paths)
  })

  it('links only to the anchors the website keeps', () => {
    expect(PUBLIC_SITE_ANCHORS).toEqual(CONTRACT.anchors)
  })
})

describe('publicSiteOrigin', () => {
  it.each([
    ['https://site.example.test', 'https://site.example.test'],
    [' https://site.example.test// ', 'https://site.example.test'],
    ['http://localhost:4321', 'http://localhost:4321'],
  ])('reads %j as %j', (value, origin) => {
    expect(publicSiteOrigin(value)).toBe(origin)
  })

  it.each([undefined, null, '', 'site.example.test', 'https://site.example.test/en', 'https://bücher.example.test', 'javascript:alert(1)'])(
    'refuses %j',
    (value) => {
      expect(publicSiteOrigin(value)).toBeNull()
    }
  )

  it(`refuses an origin longer than ${PUBLIC_SITE_ORIGIN_MAX_LENGTH} characters`, () => {
    const host = 'a'.repeat(PUBLIC_SITE_ORIGIN_MAX_LENGTH - 'https://'.length)
    expect(publicSiteOrigin(`https://${host}`)).toBe(`https://${host}`)
    expect(publicSiteOrigin(`https://${host}a`)).toBeNull()
  })
})

describe('publicSiteLink', () => {
  it('builds the page in the reader’s locale, at a section', () => {
    expect(publicSiteLink('https://site.example.test/', 'projectMail', 'de')).toBe('https://site.example.test/e-mail-eingang/')
    expect(publicSiteLink('https://site.example.test', 'projectMail', 'en', 'dkim')).toBe('https://site.example.test/en/project-mail/#dkim')
  })

  it('is null without an origin, so the UI shows no link rather than a wrong one', () => {
    expect(publicSiteLink(undefined, 'privacy', 'de')).toBeNull()
  })
})

// @disk-inputs: app/app/**

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_ROUTE_URLS } from './app-routes'

const APP_DIR = join(process.cwd(), 'app', 'app')

const isRouteGroup = (segment: string): boolean => segment.startsWith('(') && segment.endsWith(')')

const isPrivateFolder = (segment: string): boolean => segment.startsWith('_')

const isParallelSlot = (segment: string): boolean => segment.startsWith('@')

const isPageFile = (name: string): boolean => /^page\.(tsx|ts|jsx|js)$/.test(name)

function collectRouteUrls(dir: string, url: string, into: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isPrivateFolder(entry.name) || isParallelSlot(entry.name)) continue
      const nextUrl = isRouteGroup(entry.name) ? url : `${url}/${entry.name}`
      collectRouteUrls(join(dir, entry.name), nextUrl, into)
    } else if (isPageFile(entry.name)) {
      into.push(url)
    }
  }
}

describe('/app route tree', () => {
  test('resolves to exactly the checked-in URL set', () => {
    const found: string[] = []
    collectRouteUrls(APP_DIR, '/app', found)
    expect([...found].sort()).toEqual([...APP_ROUTE_URLS].sort())
  })

  test('never emits a route-group directory into a URL', () => {
    const found: string[] = []
    collectRouteUrls(APP_DIR, '/app', found)
    expect(found.filter((url) => url.includes('(') || url.includes(')'))).toEqual([])
  })

  test('the checked-in list has no duplicates', () => {
    expect(new Set(APP_ROUTE_URLS).size).toBe(APP_ROUTE_URLS.length)
  })
})

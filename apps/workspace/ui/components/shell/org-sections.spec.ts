import { describe, expect, test } from 'vitest'
import { projectIdFromPathname } from './org-sections'

describe('projectIdFromPathname', () => {
  test('reads the id out of any page inside a project', () => {
    expect(projectIdFromPathname('/app/projects/p-1')).toBe('p-1')
    expect(projectIdFromPathname('/app/projects/p-1/files')).toBe('p-1')
    expect(projectIdFromPathname('/app/projects/p-1/chat?new=1')).toBe('p-1')
  })

  test('treats the listing as org scope, not as a project', () => {
    expect(projectIdFromPathname('/app/projects')).toBeNull()
    expect(projectIdFromPathname('/app/projects/')).toBeNull()
  })

  test('is org scope for every surface above a project', () => {
    for (const path of [
      '/app/office-shelf',
      '/app/inbox',
      '/app/profile',
      '/app/organization/models',
      '/app/platform',
      '/app',
    ]) {
      expect(projectIdFromPathname(path)).toBeNull()
    }
  })

  test('decodes an id that had to be escaped in the URL', () => {
    expect(projectIdFromPathname('/app/projects/a%2Fb/files')).toBe('a/b')
  })

  test('ignores paths outside the app', () => {
    expect(projectIdFromPathname('/dev/app-rail')).toBeNull()
    expect(projectIdFromPathname('')).toBeNull()
  })
})

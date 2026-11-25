import { describe, expect, it } from 'vitest'
import { PERSONAL_SIDE, sideOfLastPlace, sideOfPath } from './shell-side'

describe('the side a page stands on', () => {
  it('is the project in a project’s page, Persönlich on a personal page, and none on a page of the office or the person', () => {
    expect(sideOfPath('/app/projects/p1/files')).toEqual({ mode: 'project', projectId: 'p1' })
    expect(sideOfPath('/app/personal-shelf')).toEqual(PERSONAL_SIDE)
    for (const path of ['/app/inbox', '/app/search', '/app/organization/members', '/app/platform', '/app/profile', '/app/whats-new', '/app/projects']) {
      expect(sideOfPath(path)).toBeNull()
    }
  })
})

describe('the side a page with none keeps, from where the person last was', () => {
  it('is that project while the person may still open it', () => {
    expect(sideOfLastPlace(encodeURIComponent('/app/projects/p1/chat?new=1'), ['p1'])).toEqual({ mode: 'project', projectId: 'p1' })
  })

  it('is Persönlich for a project gone or never there, and for no place or a broken one', () => {
    expect(sideOfLastPlace('/app/projects/p9/chat', ['p1'])).toEqual(PERSONAL_SIDE)
    expect(sideOfLastPlace(undefined, ['p1'])).toEqual(PERSONAL_SIDE)
    expect(sideOfLastPlace('%E0%A4%A', ['p1'])).toEqual(PERSONAL_SIDE)
    expect(sideOfLastPlace('/app/personal/chat', ['p1'])).toEqual(PERSONAL_SIDE)
  })

  it('never throws on a place whose project segment cannot be decoded, and stands on Persönlich', () => {
    expect(() => sideOfLastPlace(encodeURIComponent('/app/projects/%/chat'), ['p1'])).not.toThrow()
    expect(sideOfLastPlace(encodeURIComponent('/app/projects/%/chat'), ['p1'])).toEqual(PERSONAL_SIDE)
    expect(sideOfLastPlace('/app/projects/%E0%A4%A/files', ['p1'])).toEqual(PERSONAL_SIDE)
  })
})

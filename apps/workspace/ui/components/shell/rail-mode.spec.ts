import { describe, expect, it } from 'vitest'
import { NEW_PERSONAL_CHAT_HREF, PERSONAL_CHAT_PATH, PERSONAL_SHELF_PATH, personalChatHref, railModeOf } from './rail-mode'
import { projectModeHref } from './rail-mode-switch'

describe('railModeOf: which side of the rail a page belongs to (ADR-0193)', () => {
  it('reads the personal chat and Meine Ablage as personal', () => {
    expect(railModeOf(PERSONAL_CHAT_PATH)).toBe('personal')
    expect(railModeOf(`${PERSONAL_CHAT_PATH}?session=s_1`)).toBe('personal')
    expect(railModeOf(PERSONAL_SHELF_PATH)).toBe('personal')
    expect(railModeOf('/app/personal')).toBe('personal')
  })

  it('reads a project page as the project, and an office page as neither', () => {
    expect(railModeOf('/app/projects/p1/files')).toBe('project')
    expect(railModeOf('/app/office-shelf')).toBeNull()
    expect(railModeOf('/app/personal-shelfish')).toBeNull()
  })
})

describe('the rail’s links', () => {
  it('opens a personal chat by its id, and a new one without', () => {
    expect(personalChatHref('s_1')).toBe(`${PERSONAL_CHAT_PATH}?session=s_1`)
    expect(personalChatHref()).toBe(PERSONAL_CHAT_PATH)
    expect(NEW_PERSONAL_CHAT_HREF).toBe(`${PERSONAL_CHAT_PATH}?new=1`)
  })

  it('goes back to the last project, or to the list of projects', () => {
    expect(projectModeHref('p1')).toBe('/app/projects/p1/chat')
    expect(projectModeHref(null)).toBe('/app/projects')
  })
})

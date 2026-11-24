import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])
const access = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/lib/auth/require-auth', () => ({
  withPageSession: (fn: (session: unknown) => unknown) => fn({ organizationId: 'org-1' }),
}))
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(async () => {
    calls.push('access')
    if (!access.allowed) throw new Error('forbidden')
    return { readsBecauseClosed: false }
  }),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn(async () => {
    calls.push('project')
    return { id: 'p1', name: 'Haus am See', status: 'active', closedAt: null }
  }),
}))
vi.mock('@/lib/projects/folder-service', () => ({ projectRootAccess: vi.fn(async () => 'write') }))
vi.mock('@/lib/projects/project-status', () => ({ lifecycleViewOf: () => ({}) }))
vi.mock('@/lib/projects/settings-access', () => ({ holdsManageEvenWhenClosed: vi.fn(async () => false) }))
vi.mock('@/lib/authz/feature-flags', () => ({ isInboundMailEnabled: () => false, isMailImportEnabled: () => false }))
vi.mock('@/lib/inbound-mail/access', () => ({ requireMailReviewer: vi.fn() }))
vi.mock('@/components/shell', () => ({ NavigationTrailLabel: () => null, ProjectSectionFrame: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/features/documents/components/file-preview-host', () => ({ FilePreviewBridge: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/features/documents/components/project-file-drop', () => ({ ProjectFileDrop: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/features/projects/lib/current-project', () => ({ CurrentProjectProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/features/projects/components/project-status-banner', () => ({ ProjectStatusBanner: () => null }))

import ProjectLayout from './layout'

const CHAT_PAGE = <div data-testid="project-chat-page" />

function contains(node: ReactNode, target: ReactElement): boolean {
  if (node === target) return true
  if (Array.isArray(node)) return node.some((child) => contains(child, target))
  if (!isValidElement(node)) return false
  return contains((node.props as { children?: ReactNode }).children, target)
}

beforeEach(() => {
  calls.length = 0
  access.allowed = true
})

describe('the project layout gates its pages, the chat included (ADR-0193)', () => {
  test('a reader without access gets no page, so the chat never sets its scope to that project', async () => {
    access.allowed = false

    await expect(ProjectLayout({ children: CHAT_PAGE, params: Promise.resolve({ id: 'p1' }) })).rejects.toThrow('forbidden')
    expect(calls).toEqual(['access'])
  })

  test('the access check passes before the project is read and the page is handed on', async () => {
    const tree = await ProjectLayout({ children: CHAT_PAGE, params: Promise.resolve({ id: 'p1' }) })

    expect(calls).toEqual(['access', 'project'])
    expect(contains(tree, CHAT_PAGE)).toBe(true)
  })
})

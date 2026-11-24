import { createElement, forwardRef, type AnchorHTMLAttributes, type ReactNode, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@/test-utils'
import { nodesOf, parseSource, productionSources, walk, ts } from '@/test-utils/source-ast'
import { AppSidebar } from './app-sidebar'
import { PhoneMoreSheet } from './phone-more-sheet'
import { ProjectSectionFrame } from './project-section-frame'
import { ProjectSwitcher } from './project-switcher'
import { RAIL_CHAT_LIMIT, RailChatList, RailChatsSource, type RailChats } from './rail-chats'
import { phoneBackTarget } from './phone-tabs'
import { useShellOverlays } from './shell-overlays'

const shell = vi.hoisted(() => ({ pathname: '/app/projects/p1/chat', phone: false }))

vi.mock('next/navigation', () => ({
  usePathname: () => shell.pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: forwardRef<HTMLAnchorElement, { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>>(
    function MockLink({ href, children, ...rest }, ref) {
      return createElement('a', { ref, href, ...rest }, children)
    }
  ),
}))

vi.mock('@/hooks/use-last-project-section', () => ({
  useRecordProjectSection: () => {},
  pruneProjectSections: () => {},
}))

vi.mock('./connection-band', () => ({
  ConnectionBand: ({ appearance = 'band' }: { appearance?: string }) =>
    createElement('div', { 'data-testid': 'connection-band', 'data-appearance': appearance }),
}))
vi.mock('./sidebar-user-menu', () => ({ SidebarUserMenu: () => createElement('div') }))
vi.mock('@/components/brand/logo', () => ({ Logo: () => createElement('div') }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }))
vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: () => shell.phone,
}))

const PROJECT = { id: 'p1', name: 'Project One' }
const PROJECTS = [PROJECT, { id: 'p2', name: 'Project Two' }]
const BASE_PROPS = { projectId: 'p1', projects: PROJECTS, authRequired: false, canAccessInbox: true }
const FLAGS = {
  canAccessOfficeShelf: true,
  canAccessOfficeStandards: true,
  canAccessInbox: true,
  showSkills: true,
  canViewOrganization: true,
  canManageOrganization: false,
  canManagePlatform: false,
}

const CHATS: RailChats = {
  items: [
    { id: 'c1', title: 'Erste Frage', href: '/app/projects/p1/chat/c1', current: true },
    { id: 'c2', title: 'Zweite Frage', href: '/app/projects/p1/chat/c2', current: false, activity: 'working' },
  ],
  allHref: '/app/projects/p1/chats',
}

function renderRail(props: Partial<typeof BASE_PROPS> = {}, chats: RailChats | null = null) {
  return render(
    createElement(RailChatsSource, { value: chats }, createElement(AppSidebar, { ...BASE_PROPS, ...props }))
  )
}

const classesOf = (el: Element): string[] => [...el.classList]
const allClasses = (root: Element): string[] => [root, ...root.querySelectorAll('*')].flatMap(classesOf)
const elementsWith = (root: Element, tokens: string[]): Element[] =>
  [root, ...root.querySelectorAll('*')].filter((el) => tokens.every((cls) => el.classList.contains(cls)))

// The rail's own source, read as its syntax tree: every string literal (quoted, so a class list keeps its edges),
// every identifier and every property access. Comments and layout of the file are not part of it.
const codeCache = new Map<string, string>()
function codeOf(file: string): string {
  const cached = codeCache.get(file)
  if (cached !== undefined) return cached
  const parts: string[] = []
  walk(parseSource(file), (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      parts.push(`'${node.text}'`)
    } else if (ts.isIdentifier(node)) {
      parts.push(node.text)
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      parts.push(`${node.expression.text}.${node.name.text}`)
    }
  })
  const code = parts.join('\n')
  codeCache.set(file, code)
  return code
}

function jsxTagsOf(file: string): string[] {
  return nodesOf(parseSource(file), (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
  ).map((node) => node.tagName.getText())
}

const RAIL_STEMS = [
  'ui/components/shell/app-sidebar',
  'ui/components/shell/sidebar-brand',
  'ui/components/shell/project-switcher',
  'ui/components/shell/phone-project-list',
  'ui/components/shell/phone-more-sheet',
  'ui/components/shell/sidebar-user-menu',
  'ui/components/shell/connection-band',
  'ui/components/shell/connection-presence-indicator',
  'ui/components/shell/phone-tab-bar',
  'ui/components/shell/org-header',
  'ui/components/shell/shell-count',
  'ui/components/ui/sidebar',
] as const

const fileOf = (stem: string): string => {
  const files = productionSources().filter((path) => path.startsWith(`${stem}.`))
  expect(files).toHaveLength(1)
  return files[0]!
}

const railFiles = (): string[] => RAIL_STEMS.map(fileOf)

const RULES_ALLOWED: Record<string, { pattern: RegExp; reason: string }[]> = {
  'ui/components/shell/phone-tab-bar': [{ pattern: /'border-border bg-background border-t'/, reason: 'paper on paper' }],
  'ui/components/shell/org-header': [{ pattern: /border-border bg-background flex w-full shrink-0 flex-col border-b /, reason: 'a header that stays put' }],
  'ui/components/ui/sidebar': [{ pattern: /'group-data-\[side=left\]:border-r group-data-\[side=right\]:border-l border-sidebar-border'/, reason: 'the rail’s edge to the page' }],
}

const WHITE_ALLOWED: Record<string, { fill: RegExp; what: string }[]> = {
  'ui/components/shell/app-sidebar': [{ fill: /bg-sheet absolute inset-0 rounded-control shadow-xs/, what: 'the current section: a sheet with the thumb’s shadow' }],
  'ui/components/shell/phone-tab-bar': [{ fill: /in-data-\[scope=project\]:bg-sheet in-data-\[scope=project\]:shadow-xs/, what: 'the current tab: the same sheet' }],
  'ui/components/shell/phone-more-sheet': [{ fill: /bg-sheet shadow-press/, what: 'the phone’s project selector, the first row of „Mehr“: a press' }],
  'ui/components/ui/sidebar': [{ fill: /data-\[active=true\]:bg-sheet/, what: 'the primitive’s active row' }],
}

const stemOf = (file: string): string => file.replace(/\.[^/.]+$/, '')

function sourceWithout(file: string): string {
  let text = codeOf(file)
  for (const { pattern } of RULES_ALLOWED[stemOf(file)] ?? []) text = text.replace(pattern, '')
  return text
}

beforeEach(() => {
  shell.pathname = '/app/projects/p1/chat'
  shell.phone = false
})

afterEach(() => {
  window.localStorage.clear()
  useShellOverlays.setState({ moreSheetOpen: false })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the app rail’s material', () => {
  it('draws no rule between its parts or under its header, and one hairline along the page’s edge', () => {
    const { container } = renderRail()
    expect(elementsWith(container, ['group-data-[side=left]:border-r', 'group-data-[side=right]:border-l', 'border-sidebar-border'])).not.toHaveLength(0)
    const offenders = railFiles().filter((file) => /(?<![\w-:])(dark:)?border-[tbrl](?![\w-])|\bdivide-[xy]\b|\bSeparator\b|bg-border [^'"]*\bw-px\b/.test(sourceWithout(file)))
    expect(offenders).toEqual([])
  })

  it('keeps white for two things: the project selector (a press) and where the reader is (a sheet)', () => {
    const offenders = railFiles().filter((file) => {
      let text = codeOf(file)
      for (const { fill } of WHITE_ALLOWED[stemOf(file)] ?? []) {
        if (!fill.test(text)) return true
        text = text.replace(fill, '')
      }
      return /\bbg-(sheet|card|white|popover)\b|\bshadow-(xs|sm|md|lg|raised|press)\b/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('names the plane of every fill: the desk, the picked grey or the pressed grey, never „the grey“ or a step of one', () => {
    const offenders = railFiles().filter((file) =>
      /\bbg-(muted|accent|secondary|surface-sunken|on-sunken|mark-on-sunken)\b|\bbg-[a-z-]+\/\d+|\btext-(foreground|sidebar-foreground|muted-foreground)\/\d+/.test(codeOf(file))
    )
    expect(offenders).toEqual([])
  })

  it('sets the project selector as one press with the name on one line', () => {
    const { container } = renderRail()
    const selector = container.querySelector('[data-project-selector]') as HTMLElement
    expect(classesOf(selector)).toEqual(expect.arrayContaining(['bg-sheet', 'shadow-press']))
    expect(selector.querySelector('[title="Project One"]')).not.toBeNull()
    expect(allClasses(container).join(' ')).not.toMatch(/line-clamp|whitespace-normal|text-pretty/)

    const withInitials = railFiles().filter((file) => /projectInitials|ProjectMark/.test(codeOf(file)))
    expect(withInitials).toEqual([fileOf('ui/components/shell/project-switcher')])
  })

  it('the phone’s project selector is a press with the name at the section size, in „Mehr“', async () => {
    shell.phone = true
    shell.pathname = '/app/projects/p1/files'
    render(createElement(PhoneMoreSheet, { projectId: 'p1', projectName: 'Project One', projects: PROJECTS, authRequired: false, ...FLAGS }))
    act(() => useShellOverlays.setState({ moreSheetOpen: true }))
    await screen.findByRole('dialog')
    const selector = document.querySelector('[data-project-selector]') as HTMLElement
    expect(classesOf(selector)).toEqual(expect.arrayContaining(['bg-sheet', 'shadow-press']))
    const name = selector.querySelector('[title="Project One"]') as HTMLElement
    expect(classesOf(name)).toContain('text-section')
    expect(allClasses(selector).join(' ')).not.toMatch(/line-clamp|whitespace-normal|text-pretty/)
  })

  it('the section frame names the project in its crumb on a desktop and in its title on an unknown page, and offers a way back where one is', () => {
    const desktop = render(createElement(ProjectSectionFrame, { projectId: 'p1', projectName: 'Project One', pathname: '/app/projects/p1/settings/x'  } as ComponentProps<typeof ProjectSectionFrame>, createElement('div')))
    const crumb = desktop.container.querySelector('span[title="Project One"]') as HTMLElement
    expect(classesOf(crumb)).toContain('truncate')
    expect(crumb.textContent).toBe('Project One')
    expect(desktop.container.querySelector('.max-md\\:hidden')).not.toBeNull()
    expect(desktop.container.querySelector('[data-project-selector]')).toBeNull()
    expect(classesOf(desktop.container.querySelector('[data-testid="page-header-back"]') as HTMLElement)).toContain('md:hidden')
    expect(desktop.container.querySelectorAll('[data-testid="shell-search"]')).toHaveLength(1)
    expect(classesOf(desktop.container.querySelector('[data-testid="shell-search"]') as HTMLElement)).toEqual(expect.arrayContaining(['-mr-2.5', 'md:hidden']))
    desktop.unmount()

    const unknown = render(createElement(ProjectSectionFrame, { projectId: 'p1', projectName: 'Project One', pathname: '/app/projects/p1/unknown'  } as ComponentProps<typeof ProjectSectionFrame>, createElement('div')))
    expect(unknown.container.querySelector('h1, h2')?.textContent).toContain('Project One')
    unknown.unmount()

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null }))
    const phone = render(createElement(ProjectSectionFrame, { projectId: 'p1', projectName: 'Project One', pathname: '/app/projects/p1/settings/x'  } as ComponentProps<typeof ProjectSectionFrame>, createElement('div')))
    expect(phone.container.querySelector('span[title="Project One"]')).toBeNull()
    expect(phone.container.querySelector('[data-testid="page-header-back"]')).not.toBeNull()
    expect(phone.container.querySelector('[data-project-selector]')).toBeNull()
    phone.unmount()
  })

  it('on a phone, names the project in „Mehr“ and nowhere above a page: no band, no crumb, no line over the chat', () => {
    for (const stem of ['ui/components/shell/app-sidebar', 'ui/features/layout/components/ChatToolbar', 'ui/features/layout/components/ChatConnectionLine']) {
      expect(codeOf(fileOf(stem))).not.toMatch(/\bprojectName\b|\bactiveProject\b|project\.name|projects\.find|ProjectCrumb|ProjectPill|PhoneProjectList|data-project-selector|projectSwitcher\.switch/)
    }

    shell.phone = true
    shell.pathname = '/app/projects/p1/files'
    const { container } = renderRail()
    const band = container.querySelector('header[data-scope="project"]') as HTMLElement
    expect(band.textContent).not.toContain('Project One')
    expect(allClasses(band)).not.toContain('min-h-14')
    expect(band.querySelectorAll('[data-testid="shell-search"]')).toHaveLength(0)

    shell.pathname = '/app/projects/p1/setup'
    const bare = renderRail().container.querySelector('header[data-scope="project"]') as HTMLElement
    expect(bare.querySelector('[data-slot="phone-bare-line"]')).not.toBeNull()
    expect(bare.querySelectorAll('[data-testid="shell-search"]')).toHaveLength(1)
    expect(bare.textContent).not.toContain('Project One')

    expect(phoneBackTarget('/app/projects/p1/files/all', 'p1')).toBeNull()

    const doors = railFiles().filter((file) => jsxTagsOf(file).includes('PhoneProjectList'))
    expect(doors).toEqual([fileOf('ui/components/shell/phone-more-sheet')])
    expect(productionSources().some((path) => path.startsWith('ui/components/shell/project-crumb.'))).toBe(false)
  })

  it('sets a row at 13px, muted at 440 at rest and ink at 500 where the reader is: never 14px or 600', () => {
    shell.pathname = '/app/projects/p1/files'
    const { container } = renderRail({}, CHATS)
    const labels = [...container.querySelectorAll('[data-slot="rail-nav-label"]')]
    const rest = labels.find((el) => el.textContent === 'Overview')!.closest('a') as HTMLElement
    expect(classesOf(rest)).toEqual(expect.arrayContaining(['text-muted-foreground', 'h-9', 'text-[13px]', 'font-normal']))
    const active = container.querySelector('nav a[aria-current="page"]') as HTMLElement
    expect(classesOf(active)).toEqual(expect.arrayContaining(['font-medium', 'data-[active=true]:font-medium']))
    expect(allClasses(container)).not.toContain('font-semibold')

    const { container: switcher } = render(createElement(ProjectSwitcher, { projects: PROJECTS, activeProjectId: 'p1', collapsed: true }))
    expect(allClasses(switcher).filter((cls) => cls === 'font-semibold')).toHaveLength(1)
    const title = render(createElement(ProjectSwitcher, { projects: PROJECTS, activeProjectId: 'p1' })).container.querySelector('[title="Project One"]') as HTMLElement
    expect(classesOf(title)).toEqual(expect.arrayContaining(['text-[13px]', 'font-medium']))

    const { container: list } = render(createElement(RailChatList, { chats: CHATS, pillId: 'rail-pill' }))
    expect(allClasses(list).filter((cls) => /^text-(sm|name)$/.test(cls))).toEqual([])
  })

  it('lists the last chats under the sections as the one part that scrolls, between two parts that stand still', () => {
    const { container } = renderRail({}, CHATS)
    const chatList = container.querySelector('[data-testid="rail-chats"]') as HTMLElement
    const chatSection = chatList.closest('section') as HTMLElement
    const sectionNav = chatSection.previousElementSibling as HTMLElement
    expect(sectionNav.tagName).toBe('NAV')
    expect(sectionNav.compareDocumentPosition(chatSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(classesOf(sectionNav.parentElement as HTMLElement)).toEqual(expect.arrayContaining(['mt-3', 'min-h-0', 'flex-1', 'gap-0', 'overflow-hidden']))

    expect(classesOf(chatList)).toEqual(expect.arrayContaining(['overflow-y-auto', '-mx-px', 'p-px']))
    expect(RAIL_CHAT_LIMIT).toBeGreaterThan(0)
    expect(RAIL_CHAT_LIMIT).toBeLessThanOrEqual(12)

    const last = chatList.lastElementChild as HTMLElement
    expect(classesOf(last)).toContain('shrink-0')
    const allChats = last.querySelector('[data-testid="rail-all-chats"]') as HTMLElement
    expect(classesOf(allChats)).toEqual(expect.arrayContaining(['text-meta', 'font-medium']))

    const toggle = container.querySelector('[data-testid="rail-chats-toggle"]') as HTMLElement
    expect(toggle.textContent).not.toBe('')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe(chatList.id)
  })

  it('sets its labels at 12px or larger: no 10.5px or 11px fine print', () => {
    const offenders = railFiles().filter((file) => /\btext-\[(10|10\.5|11|11\.5)px\]/.test(codeOf(file)))
    expect(offenders).toEqual([])
  })
})

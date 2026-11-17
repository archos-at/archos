import crypto from 'crypto'
import { createElement } from 'react'
import { beforeAll, afterEach, afterAll, vi } from 'vitest'
import { resetDatabase } from '../../tests/mocks/database'
import { refuseNetwork } from './network-guard'

// specs). A `@vitest-environment node` spec renders nothing for a DOM matcher
// DOM setup costs ~0.17 s per file (measured 2026-10-22 on empty specs).
const hasDom = typeof document !== 'undefined'
if (hasDom) await import('@testing-library/jest-dom/vitest')
const server = hasDom ? (await import('../../tests/mocks/server')).server : null

vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  AuthKitProvider: ({ children }: { children: React.ReactNode }) => children,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  useAuth: vi.fn(() => ({
    user: null,
    organizationId: undefined,
    loading: false,
    getAuth: vi.fn(),
    signOut: vi.fn(),
  })),
  useAccessToken: vi.fn(() => ({
    accessToken: undefined,
    loading: false,
    error: undefined,
    getAccessToken: vi.fn(),
  })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` })
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}))

vi.mock('@xyflow/react', async () => {
  const { createElement, Fragment } = await import('react')
  return {
    Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
    Handle: () => null,
    ReactFlowProvider: ({ children }: { children: unknown }) => children,
    ReactFlow: ({
      nodes = [],
      nodeTypes = {},
    }: {
      nodes?: Array<{ id: string; type: string; data: unknown }>
      nodeTypes?: Record<string, React.ComponentType<{ id: string; type: string; data: unknown }>>
    }) =>
      createElement(
        Fragment,
        null,
        ...nodes.map((n) => {
          const Comp = nodeTypes[n.type]
          return Comp ? createElement(Comp, { key: n.id, id: n.id, type: n.type, data: n.data }) : null
        }),
      ),
    useNodesInitialized: () => true,
    useUpdateNodeInternals: () => () => {},
    useReactFlow: () => ({
      getNodes: () => [],
      getNodesBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      setViewport: () => {},
    }),
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  }
})

vi.mock('external-svg-loader', () => ({}))

const createSvgIcon = (props: Record<string, unknown>, testId: string) => {
  const {
    className,
    role,
    width,
    height,
    style,
    color,
    'aria-label': ariaLabel,
    'aria-hidden': ariaHidden,
  } = props

  return createElement('svg', {
    className,
    role,
    width,
    height,
    style,
    color,
    'aria-label': ariaLabel,
    'aria-hidden': ariaHidden,
    'data-testid': testId,
  })
}

vi.mock('@nv-brand-assets/react-icons', () => ({
  NvidiaGUIIcon: (props: Record<string, unknown>) =>
    createSvgIcon(props, 'mock-nvidia-gui-icon'),
}))
vi.mock('@nv-brand-assets/react-marketing-icons', () => ({
  NvidiaMarketingIcon: (props: Record<string, unknown>) =>
    createSvgIcon(props, 'mock-nvidia-marketing-icon'),
}))

// @ts-expect-error - Setting NODE_ENV for tests
process.env.NODE_ENV = 'test'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: crypto.webcrypto, configurable: true })
}

function createStorageMock() {
  let storage: Record<string, string> = {}

  return {
    clear: () => (storage = {}),
    getItem: (key: string) => (key in storage ? storage[key] : null),
    getAll: () => storage,
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length
    },
    removeItem: (key: string) => {
      delete storage[key]
    },
    setItem: (key: string, value: string) => {
      storage[key] = String(value)
    },
  }
}

const localStorageMock = createStorageMock()
const sessionStorageMock = createStorageMock()

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class MutationObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(global, 'localStorage', { value: localStorageMock, configurable: true })
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock, configurable: true })
global.ResizeObserver = ResizeObserver

if (typeof globalThis.localStorage?.removeItem !== 'function') {
  const mem: Record<string, string> = {}
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (key in mem ? mem[key] : null),
      setItem: (key: string, value: string) => {
        mem[key] = value
      },
      removeItem: (key: string) => {
        delete mem[key]
      },
      clear: () => {
        for (const k of Object.keys(mem)) delete mem[k]
      },
      key: (index: number) => Object.keys(mem)[index] ?? null,
      get length() {
        return Object.keys(mem).length
      },
    } as Storage,
    configurable: true,
  })
}
// @ts-expect-error - Partial mock
global.IntersectionObserver = IntersectionObserver
// @ts-expect-error - Partial mock
global.MutationObserver = MutationObserver

const originalDateToLocaleString = Date.prototype.toLocaleString
const originalDateToLocaleDateString = Date.prototype.toLocaleDateString
const originalDateToLocaleTimeString = Date.prototype.toLocaleTimeString
const originalNumberToLocaleString = Number.prototype.toLocaleString

function toEffectiveLocales(locales?: string | string[] | undefined) {
  if (!locales) return 'en-US'
  if (Array.isArray(locales) && locales.length === 0) return 'en-US'
  return locales
}

Date.prototype.toLocaleString = function (
  locales?: string | string[] | undefined,
  options?: Intl.DateTimeFormatOptions | undefined,
) {
  return originalDateToLocaleString.call(this, toEffectiveLocales(locales), options)
}

Date.prototype.toLocaleDateString = function (
  locales?: string | string[] | undefined,
  options?: Intl.DateTimeFormatOptions | undefined,
) {
  return originalDateToLocaleDateString.call(
    this,
    toEffectiveLocales(locales),
    options,
  )
}

Date.prototype.toLocaleTimeString = function (
  locales?: string | string[] | undefined,
  options?: Intl.DateTimeFormatOptions | undefined,
) {
  return originalDateToLocaleTimeString.call(
    this,
    toEffectiveLocales(locales),
    options,
  )
}

Number.prototype.toLocaleString = function (
  locales?: string | string[] | undefined,
  options?: Intl.NumberFormatOptions | undefined,
) {
  return originalNumberToLocaleString.call(this, toEffectiveLocales(locales), options)
}

refuseNetwork()

beforeAll(() => {
  localStorageMock.clear()
  sessionStorageMock.clear()
  return server?.listen({ onUnhandledRequest: 'bypass' })
})

afterEach(() => {
  server?.resetHandlers()
  resetDatabase()
})

afterAll(() => server?.close())

/**
 * Gateway Server with WebSocket Proxy
 *
 * Architecture (following Nemo-Agent-Toolkit-UI pattern):
 * - Runs on port 3000 as the main entry point
 * - Proxies to Next.js server (dev on 3001, or production on same process)
 * - Proxies /websocket to the backend's chat role (BACKEND_CHAT_URL). This is the
 *   only backend traffic this process carries; every HTTP call to the backend is
 *   the BFF's, to the api role (BACKEND_URL).
 *
 * Development:
 *   npm run dev - Runs gateway + Next.js dev server concurrently
 *
 * Production:
 *   npm start - Runs Next.js in production mode with integrated proxy
 *
 * Environment:
 *   BACKEND_CHAT_URL - The backend's chat role, for the WebSocket proxy (e.g.,
 *     http://aiq-agent:8000). Required: it does not fall back to BACKEND_URL,
 *     which is the api role and serves no chat socket (ADR-0082 step B).
 *   PORT - Gateway port (default: 3000)
 *   NEXT_INTERNAL_URL - Next.js server URL (default: http://localhost:3001)
 */

const http = require('http')
const httpProxy = require('http-proxy')
const { parse } = require('url')
const crypto = require('crypto')

const { bootLogLine } = require('./bff/boot-line.js')
const { turnContextHeaders } = require('./bff/turns/turn-headers.js')

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const getBackendChatUrl = () => {
  const url = (process.env.BACKEND_CHAT_URL || '').trim()
  if (!url) {
    throw new Error(
      'BACKEND_CHAT_URL is required: the URL of the backend chat role, which the WebSocket proxy dials ' +
        '(e.g. http://aiq-agent:8000). BACKEND_URL is the api role and is not a fallback.',
    )
  }
  return url.replace(/\/$/, '')
}

const BACKEND_CHAT_URL = getBackendChatUrl()
const BACKEND_WS_URL = BACKEND_CHAT_URL.replace(/^http/, 'ws')
const NEXT_INTERNAL_URL = process.env.NEXT_INTERNAL_URL || 'http://localhost:3001'

const { affinityEnabled, createBackendTargetPicker } = require('./bff/proxy/backend-target.js')
const BACKEND_REPLICAS = Math.max(1, parseInt(process.env.BACKEND_REPLICAS || '1', 10) || 1)
// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
const BACKEND_POD_WS_TEMPLATE = process.env.BACKEND_POD_WS_TEMPLATE || ''
const CHAT_AFFINITY = affinityEnabled(process.env.CHAT_AFFINITY)
const pickBackendWsTarget = createBackendTargetPicker({
  replicas: BACKEND_REPLICAS,
  podTemplate: BACKEND_POD_WS_TEMPLATE,
  affinity: CHAT_AFFINITY,
  serviceUrl: BACKEND_WS_URL,
})

const FRONTEND_REPLICAS = Math.max(1, parseInt(process.env.FRONTEND_REPLICAS || '1', 10) || 1)

const { initOtelMetrics, shutdownOtelMetrics } = require('./observability/otel-metrics.js')
const { measureRequest } = require('./observability/http-metrics.js')
initOtelMetrics()

const SHUTDOWN_DRAIN_MS = Math.max(
  0,
  parseInt(process.env.SHUTDOWN_DRAIN_MS || '', 10) || 2000
)
const SHUTDOWN_HOOKS_KEY = '__appShutdownHooks'
const SHUTDOWN_HOOKS_MS = 2000
let draining = false

const { handleWsProxyError, watchSplicedSockets } = require('./bff/proxy/ws-teardown.js')

const { WS_UPGRADE_LIMIT, CHAT_TURN_LIMIT, WS_CONTROL_LIMIT } = require('./bff/limits/rules.js')
const { createLimiter, consumeLimiter } = require('./bff/limits/factory.js')
const { createFrameObserver, classifyFrame } = require('./bff/limits/ws-frames.js')
const { stripClientContextHeaders, findOversizedWsHeader, withoutSessionCookies } = require('./bff/proxy/ws-upgrade-headers.js')

const parsedUpgradeOverride = parseInt(
  process.env.WS_UPGRADE_RATE_LIMIT || String(WS_UPGRADE_LIMIT.limit),
  10
)
if (!Number.isFinite(parsedUpgradeOverride)) {
  console.warn(
    '[Gateway] invalid WS_UPGRADE_RATE_LIMIT=%s, using catalog default %d',
    process.env.WS_UPGRADE_RATE_LIMIT,
    WS_UPGRADE_LIMIT.limit
  )
}
const WS_UPGRADE_OVERRIDE = Number.isFinite(parsedUpgradeOverride)
  ? parsedUpgradeOverride
  : WS_UPGRADE_LIMIT.limit
const WS_MESSAGE_LIMITS_ENABLED = process.env.WS_MESSAGE_LIMITS !== '0'

let limitStoreClient = null
if (process.env.REDIS_URL) {
  try {
    const { createRedisClient } = require('./bff/redis/connect.js')
    limitStoreClient = createRedisClient(process.env.REDIS_URL, 'Gateway', { commandTimeout: 500 })
  } catch (error) {
    console.warn('[Gateway] shared rate limiter unavailable, using per-process buckets:', error.message)
  }
}

const upgradeLimiter =
  WS_UPGRADE_OVERRIDE > 0
    ? createLimiter({ ...WS_UPGRADE_LIMIT, limit: WS_UPGRADE_OVERRIDE }, limitStoreClient)
    : null
const frameLimiters = WS_MESSAGE_LIMITS_ENABLED
  ? {
      'chat-turn': createLimiter(CHAT_TURN_LIMIT, limitStoreClient),
      control: createLimiter(WS_CONTROL_LIMIT, limitStoreClient),
    }
  : null

const getClientKey = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * Bucket key for frames on one socket.
 *
 * The session cookie, hashed — the same idiom `scopeCacheKey` uses below, and
 * for the same reason: it identifies the session stably without putting a
 * credential in a key. Deliberately NOT the client IP: several tabs of one user
 * share a budget (they share an account), while two users behind one NAT do
 * not.
 */
const sessionKey = (req) =>
  crypto.createHash('sha256').update(req.headers.cookie || getClientKey(req)).digest('hex')

async function wsUpgradeAllowed(clientKey) {
  if (!upgradeLimiter) return true
  const outcome = await consumeLimiter(upgradeLimiter, clientKey)
  return outcome.allowed
}

/**
 * Watch one client socket and close it if it exceeds its frame budget.
 *
 * Passive: the observer is an extra `data` listener, so nothing about what gets
 * forwarded changes. Enforcement is necessarily *after the fact* — the frame
 * has already been spliced upstream by the time we finish parsing it — so the
 * action on refusal is to close the connection rather than to drop a message.
 * That is the standard answer for WebSockets, where there is no 429 to send,
 * and it is safe: the client reconnects on its jittered backoff and the
 * upgrade limiter above then paces it.
 */
function watchClientFrames(socket, key) {
  if (!frameLimiters) return null

  let closing = false
  const observer = createFrameObserver((frame) => {
    const kind = classifyFrame(frame)
    if (kind === 'ignore' || closing) return

    consumeLimiter(frameLimiters[kind], `${kind}:${key}`)
      .then((outcome) => {
        if (outcome.allowed || closing) return
        closing = true
        console.warn('[WS Proxy] frame budget exceeded (%s), closing socket', kind)
        try {
          socket.end(Buffer.from([0x88, 0x02, 0x03, 0xf0]))
        } catch {
          socket.destroy()
        }
      })
      .catch(() => {
        // Fail open: a store failure must not sever a live chat.
      })
  })

  socket.on('data', (chunk) => observer.push(chunk))
  return observer
}

let nextApp = null
let nextHandle = null

if (!dev) {
  const next = require('next')
  nextApp = next({ dev: false, hostname, port: 3001 })
  nextHandle = nextApp.getRequestHandler()
}

const nextProxy = httpProxy.createProxyServer({
  target: NEXT_INTERNAL_URL,
  changeOrigin: true,
  ws: true,
  xfwd: true,
  preserveHeaderKeyCase: true,
})

const backendProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  xfwd: true,
  preserveHeaderKeyCase: true,
})

nextProxy.on('error', (err, req, res) => {
  console.error('[Next.js Proxy Error]:', err.message)
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
  }
  if (res && !res.writableEnded) {
    res.end(JSON.stringify({ error: 'Next.js server unavailable' }))
  }
})

backendProxy.on('error', (err, req, res) => {
  console.error('[Backend Proxy Error]:', err.message)
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
  }
  if (res && !res.writableEnded) {
    res.end(JSON.stringify({ error: 'Backend unavailable' }))
  }
})

backendProxy.on('proxyReqWs', (proxyReq, req, socket) => {
  const cookie = withoutSessionCookies(req.headers.cookie)
  if (cookie) {
    proxyReq.setHeader('Cookie', cookie)
  } else {
    proxyReq.removeHeader('Cookie')
  }
  const oversized = findOversizedWsHeader(proxyReq.getHeaders())
  if (oversized) {
    console.warn('[WS Proxy] Header exceeds upstream line budget: %s (%d bytes)', oversized.name, oversized.bytes)
    socket.write('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n')
    socket.destroy()
    proxyReq.destroy()
    return
  }
  proxyReq.once('upgrade', (_proxyRes, proxySocket) => {
    proxySocket.setKeepAlive?.(true, 15000)
    watchSplicedSockets(socket, proxySocket)
  })
})

const normalizeQueryParam = (value) => {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

const fetchCollectionScopeHeader = (req, projectId, conversationId) => {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams()
    if (projectId) query.set('projectId', projectId)
    if (conversationId) query.set('conversationId', conversationId)

    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/api/auth/websocket-scope?${query.toString()}`,
        method: 'GET',
        headers: {
          ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data)
              resolve({ ok: true, status: res.statusCode, header: json.header, data: json })
            } catch (err) {
              console.warn('[WS Proxy] Failed to parse collection scope response:', err.message)
              resolve({ ok: false, status: res.statusCode, header: null, data: null })
            }
          } else {
            resolve({ ok: false, status: res.statusCode, header: null, data: null })
          }
        })
      }
    )

    request.setTimeout(5000, () => {
      request.destroy()
      reject(new Error('Collection scope request timed out'))
    })

    request.on('error', (err) => {
      console.warn('[WS Proxy] Collection scope request failed:', err.message)
      resolve({ ok: false, status: null, header: null, data: null })
    })

    request.end()
  })
}

const WS_UPGRADE_MAX_INFLIGHT = parseInt(process.env.WS_UPGRADE_MAX_INFLIGHT || '32', 10)
const WS_SCOPE_CACHE_TTL_MS = parseInt(process.env.WS_SCOPE_CACHE_TTL_MS || '10000', 10)
const WS_SCOPE_CACHE_MAX_ENTRIES = 5000

let inflightScopeResolutions = 0
const scopeCache = new Map()
const scopeInflight = new Map()

const scopeCacheKey = (req, projectId, conversationId) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([req.headers.cookie || '', projectId ?? null, conversationId ?? null])
    )
    .digest('hex')

/**
 * Resolve the collection scope for an upgrade, memoised and admission-gated.
 *
 * Returns the same shape as `fetchCollectionScopeHeader`, plus `rejected: true`
 * when the global in-flight ceiling shed this upgrade.
 */
const resolveCollectionScope = (req, projectId, conversationId) => {
  const cacheEnabled = WS_SCOPE_CACHE_TTL_MS > 0
  const key = cacheEnabled ? scopeCacheKey(req, projectId, conversationId) : null

  if (cacheEnabled) {
    const cached = scopeCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.result)
    }

    const pending = scopeInflight.get(key)
    if (pending) return pending
  }

  if (WS_UPGRADE_MAX_INFLIGHT > 0 && inflightScopeResolutions >= WS_UPGRADE_MAX_INFLIGHT) {
    return Promise.resolve({ ok: false, status: 503, header: null, data: null, rejected: true })
  }

  inflightScopeResolutions += 1
  const request = fetchCollectionScopeHeader(req, projectId, conversationId)
    .then((result) => {
      if (cacheEnabled && result.ok) {
        if (scopeCache.size > WS_SCOPE_CACHE_MAX_ENTRIES) scopeCache.clear()
        scopeCache.set(key, { expiresAt: Date.now() + WS_SCOPE_CACHE_TTL_MS, result })
      }
      return result
    })
    .finally(() => {
      inflightScopeResolutions -= 1
      if (cacheEnabled) scopeInflight.delete(key)
    })

  if (cacheEnabled) scopeInflight.set(key, request)
  return request
}

const startServer = async () => {
  if (!dev && nextApp) {
    await nextApp.prepare()
  }

  const server = http.createServer(async (req, res) => {
    req.socket.setKeepAlive?.(true, 15000)
    req.socket.setTimeout?.(0)

    let parsedUrl
    try {
      parsedUrl = parse(req.url, true)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad Request')
      return
    }
    measureRequest(req, res, parsedUrl.pathname)

    if (draining && parsedUrl.pathname === '/api/healthz') {
      res.writeHead(503, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify({ status: 'draining' }))
      return
    }

    if (dev) {
      nextProxy.web(req, res, { target: NEXT_INTERNAL_URL })
    } else {
      try {
        await nextHandle(req, res, parsedUrl)
      } catch (err) {
        console.error('Error handling request:', err)
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    }
  })

  server.on('upgrade', async (req, socket, head) => {
    socket.setKeepAlive?.(true, 15000)
    socket.setTimeout?.(0)

    let parsedUrl
    try {
      parsedUrl = parse(req.url, true)
    } catch {
      socket.destroy()
      return
    }
    const pathname = parsedUrl.pathname || '/'

    if (draining) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    if (pathname === '/websocket' || pathname.startsWith('/websocket')) {
      if (!(await wsUpgradeAllowed(getClientKey(req)))) {
        socket.write(
          'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nConnection: close\r\n\r\n'
        )
        socket.destroy()
        return
      }

      const projectId = normalizeQueryParam(parsedUrl.query.projectId)
      const conversationId = normalizeQueryParam(parsedUrl.query.conversationId)
      req.url = '/websocket' + (parsedUrl.search || '')
      stripClientContextHeaders(req.headers)

      try {
        const result = await resolveCollectionScope(req, projectId, conversationId)
        if (result.rejected) {
          try {
            socket.write(
              'HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\n\r\n'
            )
          } catch {}
          socket.destroy()
          return
        }
        if (result.ok && result.header) {
          if (result.data?.organizationId && result.data?.userId && !process.env.INTERNAL_API_TOKEN) {
            console.warn('[WS Proxy] Signed turn context unavailable: internal service token is not configured')
            socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
            socket.destroy()
            return
          }
          // nosemgrep: javascript.express.security.express-data-exfiltration.express-data-exfiltration
          Object.assign(
            req.headers,
            turnContextHeaders(result.data, {
              issuedAt: Date.now(),
              secret: process.env.INTERNAL_API_TOKEN,
            })
          )
        } else if (result.status === 401 || result.status === 403) {
          const statusText = result.status === 401 ? 'Unauthorized' : 'Forbidden'
          try {
            socket.write(`HTTP/1.1 ${result.status} ${statusText}\r\n\r\n`)
          } catch {}
          socket.destroy()
          return
        } else {
          console.warn(
            '[WS Proxy] Collection scope unavailable (status: %s), rejecting upgrade',
            result.status
          )
          try {
            socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
          } catch {}
          socket.destroy()
          return
        }
      } catch (err) {
        console.warn('[WS Proxy] Collection scope lookup failed:', err.message)
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
        } catch {}
        socket.destroy()
        return
      }

      const oversized = findOversizedWsHeader(req.headers)
      if (oversized) {
        console.warn('[WS Proxy] Header exceeds upstream line budget: %s (%d bytes)', oversized.name, oversized.bytes)
        socket.write('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      const frameObserver = watchClientFrames(socket, sessionKey(req))
      if (frameObserver && head && head.length > 0) frameObserver.push(head)

      try {
        backendProxy.ws(
          req,
          socket,
          head,
          { target: pickBackendWsTarget(conversationId), changeOrigin: true },
          (err) => {
            if (err) handleWsProxyError(err, socket)
          }
        )
      } catch (err) {
        console.error('[WS Proxy] Upgrade failed synchronously:', err.message)
        try {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        } catch {}
        socket.destroy()
      }
      return
    }

    if (dev) {
      nextProxy.ws(req, socket, head, { target: NEXT_INTERNAL_URL }, (err) => {
        if (err) {
          console.error('[Next.js WS] Proxy error:', err.message)
          socket.destroy()
        }
      })
    } else {
      const upgradeHandler = nextApp.getUpgradeHandler()
      upgradeHandler(req, socket, head)
    }
  })

  server.keepAliveTimeout = 0
  server.headersTimeout = 65000
  server.requestTimeout = 0

  if (FRONTEND_REPLICAS > 1 && !process.env.REDIS_URL) {
    console.error(
      `[Gateway] WARNING: FRONTEND_REPLICAS=${FRONTEND_REPLICAS} but REDIS_URL is unset — ` +
        'the shared cache and WS rate limiter will run per-process and diverge across replicas. ' +
        'Set REDIS_URL (Dragonfly) for correct multi-replica behavior.',
    )
  }

  server.listen(port, hostname, () => {
    console.log(bootLogLine(process.env))
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Frontend: http://localhost:${port}
  Chat:     ${BACKEND_CHAT_URL}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
  })

  let exiting = false
  const exitAfterHooks = () => {
    if (exiting) return
    exiting = true
    const appHooks = Array.isArray(globalThis[SHUTDOWN_HOOKS_KEY]) ? globalThis[SHUTDOWN_HOOKS_KEY] : []
    const hooks = [...appHooks, shutdownOtelMetrics]
    const ceiling = setTimeout(() => process.exit(0), SHUTDOWN_HOOKS_MS)
    Promise.allSettled(hooks.map((hook) => hook())).finally(() => {
      clearTimeout(ceiling)
      process.exit(0)
    })
  }

  const cleanExit = (signal) => {
    if (draining) return
    draining = true
    console.log(`\nShutting down (${signal}) — draining for up to ${SHUTDOWN_DRAIN_MS}ms...`)
    server.close(exitAfterHooks)
    setTimeout(exitAfterHooks, SHUTDOWN_DRAIN_MS)
  }

  process.once('SIGTERM', () => cleanExit('SIGTERM'))
  process.once('SIGINT', () => cleanExit('SIGINT'))
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

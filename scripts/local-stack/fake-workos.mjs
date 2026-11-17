// A TEST DOUBLE of the WorkOS API, for the local stack only (docs/contributing/local-stack.md).
//
// It implements just enough for the workspace to run with a real signed-in
// session and no WorkOS account:
//
//   - the JWKS AuthKit verifies access tokens with (GET /sso/jwks/:clientId);
//   - one organization ("Büro Testwerk") with two users, anna and bert, both
//     active members with the `admin` role;
//   - the reads the BFF makes on most requests: memberships, users, the
//     organization, its roles, permissions and feature flags;
//   - GET /organizations/external_id/:id answers 404, so nobody is on the
//     platform organization and the operator console stays closed;
//   - every write (resources, role assignments, deletes) answers 200 with an
//     object carrying an `id`, a `resource` and a `source`, which is what
//     project creation reads back; nothing is stored.
//
// It does NOT implement sign-in (no hosted page, no code exchange, no token
// refresh: an expired session is minted again), directory sync, SSO, audit
// logs, widgets, or any check of what a write asked for. Authorization that
// WorkOS decides in production is "allowed" here.
//
// Usage:
//   node fake-workos.mjs serve        serve on 127.0.0.1:$LOCAL_STACK_WORKOS_PORT
//   node fake-workos.mjs mint <user>  print a sealed `wos-session` cookie value
//
// Reads LOCAL_STACK_DIR (signing key), LOCAL_STACK_UI_DIR (for `jose`,
// `iron-session` and the feature-flag registry), WORKOS_CLIENT_ID and
// WORKOS_COOKIE_PASSWORD, all set by local-stack.sh.
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'

if (process.env.NODE_ENV === 'production') {
  console.error('fake-workos: refusing to run with NODE_ENV=production. This is a test double.')
  process.exit(1)
}

const env = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(`fake-workos: ${name} is not set (run it through scripts/local-stack/local-stack.sh)`)
    process.exit(1)
  }
  return value
}

const uiDir = env('LOCAL_STACK_UI_DIR')
const stackDir = env('LOCAL_STACK_DIR')
const require = createRequire(path.join(uiDir, 'package.json'))
const jose = require('jose')

// WorkOS-shaped ids (a prefix and 26 upper-case characters): internal routes
// refuse an organization id that is not `org_` plus letters and digits.
const workosId = (prefix, tag) => `${prefix}_${`01${tag}`.padEnd(26, '0')}`
const ORG = { id: workosId('org', 'LOCALOFFICE'), name: 'Büro Testwerk' }
const USERS = {
  anna: { id: workosId('user', 'LOCALANNA'), email: 'anna@testwerk.example', firstName: 'Anna', lastName: 'Erste' },
  bert: { id: workosId('user', 'LOCALBERT'), email: 'bert@testwerk.example', firstName: 'Bert', lastName: 'Zweiter' },
}
const ORG_PERMISSIONS = [
  'org:archiv:manage', 'org:audit:view', 'org:budgets:manage', 'org:compliance:manage', 'org:downloads:view',
  'org:members:manage', 'org:models:manage', 'org:office_shelf:manage', 'org:projects:administer',
  'org:projects:create', 'org:settings:manage', 'org:skills:manage',
]
const RESOURCE_PERMISSIONS = [
  'project:chat', 'project:documents:generate', 'project:documents:write', 'project:edit', 'project:manage',
  'project:members:manage', 'project:memory:write', 'project:skills:manage', 'project:view', 'folder:read', 'folder:write',
]

// The flags this office has: every `rollout` flag of the registry (what a
// customer sees), plus `runtime-model-config` so the Organization → Models page
// can switch zero data retention off and pick a model, plus LOCAL_STACK_FLAGS.
function featureFlags() {
  const registry = fs.readFileSync(path.join(uiDir, 'bff/authz/feature-flags.ts'), 'utf8')
  const rollout = [...registry.matchAll(/^\s*'([a-z0-9-]+)': 'rollout',$/gm)].map((match) => match[1])
  const extra = (process.env.LOCAL_STACK_FLAGS ?? '').split(',').map((flag) => flag.trim()).filter(Boolean)
  return [...new Set([...rollout, 'runtime-model-config', ...extra])]
}

async function signingKey() {
  const file = path.join(stackDir, 'workos-signing-key.json')
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
  const jwk = { ...(await jose.exportJWK(privateKey)), kid: 'local-stack', alg: 'RS256', use: 'sig' }
  fs.writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 })
  return jwk
}

const now = () => new Date().toISOString()
const list = (data) => ({ object: 'list', data, list_metadata: { before: null, after: null } })
const userBody = (u) => ({
  object: 'user', id: u.id, email: u.email, email_verified: true, first_name: u.firstName, last_name: u.lastName,
  profile_picture_url: null, created_at: now(), updated_at: now(),
})
const membership = (userId) => ({
  object: 'organization_membership', id: `om_${userId}`, user_id: userId, organization_id: ORG.id,
  organization_name: ORG.name, status: 'active', role: { slug: 'admin' }, roles: [{ slug: 'admin' }],
  created_at: now(), updated_at: now(),
})
const organization = () => ({
  object: 'organization', id: ORG.id, name: ORG.name, domains: [], metadata: {}, external_id: null,
  created_at: now(), updated_at: now(),
})
const permission = (slug) => ({
  object: 'permission', id: `perm_${slug.replace(/\W/g, '_')}`, slug, name: slug, description: '', system: false,
  resource_type_slug: slug.startsWith('org:') ? 'organization' : slug.split(':')[0], created_at: now(), updated_at: now(),
})
const written = () => ({
  object: 'authorization_resource', id: `local_${Math.random().toString(36).slice(2)}`, external_id: 'local',
  name: 'local', resource_type_slug: 'project', organization_id: ORG.id, role: { slug: 'project-admin' },
  resource: { id: 'local_resource', external_id: 'local', resource_type_slug: 'project' }, source: { type: 'direct' },
  organization_membership_id: 'om_local', created_at: now(), updated_at: now(),
})

/** The answer to one request, or null for a 404. */
function answer(method, url, publicKey, flags) {
  const p = url.pathname
  const userId = url.searchParams.get('user_id')
  if (p.startsWith('/sso/jwks/')) return { keys: [publicKey] }
  if (p === '/user_management/organization_memberships') {
    return list(userId ? [membership(userId)] : Object.values(USERS).map((u) => membership(u.id)))
  }
  if (p.startsWith('/user_management/organization_memberships/')) return membership(p.split('/').pop().slice(3))
  if (p === '/user_management/users') return list(Object.values(USERS).map(userBody))
  if (p.startsWith('/user_management/users/')) {
    const user = Object.values(USERS).find((u) => u.id === p.split('/').pop())
    return user ? userBody(user) : null
  }
  if (/feature[-_]flags/.test(p)) {
    return list(flags.map((slug) => ({
      object: 'feature_flag', id: `flag_${slug}`, slug, name: slug, description: '', enabled: true,
      default_value: true, tags: [], created_at: now(), updated_at: now(),
    })))
  }
  if (/\/roles$/.test(p)) {
    return list([{
      object: 'role', id: 'role_admin', slug: 'admin', name: 'Admin', description: '', type: 'EnvironmentRole',
      permissions: ORG_PERMISSIONS, created_at: now(), updated_at: now(),
    }])
  }
  if (/permissions/.test(p)) return list(RESOURCE_PERMISSIONS.map(permission))
  if (p.startsWith('/organizations/external_id/')) return null
  if (p === '/organizations') return list([organization()])
  if (p.startsWith('/organizations/')) return organization()
  if (method !== 'GET') return written()
  return list([])
}

async function serve() {
  const port = Number(env('LOCAL_STACK_WORKOS_PORT'))
  const jwk = await signingKey()
  const publicKey = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: jwk.kid, alg: 'RS256', use: 'sig' }
  const flags = featureFlags()
  http
    .createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = answer(req.method ?? 'GET', url, publicKey, flags)
      const status = body === null ? 404 : 200
      console.log(`${now()} ${req.method} ${req.url} -> ${status}`)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body ?? { message: 'not found' }))
    })
    .listen(port, '127.0.0.1', () => {
      console.log(`fake-workos: TEST DOUBLE of the WorkOS API on http://127.0.0.1:${port} (not WorkOS; local stack only)`)
      console.log(`fake-workos: users ${Object.keys(USERS).join(', ')} in "${ORG.name}"; flags ${flags.join(', ')}`)
    })
}

async function mint(name) {
  const user = USERS[name]
  if (!user) {
    console.error(`fake-workos: unknown user "${name}"; known: ${Object.keys(USERS).join(', ')}`)
    process.exit(1)
  }
  const ironSession = require('iron-session')
  const jwk = await signingKey()
  const key = await jose.importJWK(jwk, 'RS256')
  const accessToken = await new jose.SignJWT({
    sid: `session_${user.id}`, org_id: ORG.id, organization_name: ORG.name, role: 'admin', roles: ['admin'],
    permissions: ORG_PERMISSIONS, feature_flags: featureFlags(), entitlements: [],
  })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setSubject(user.id)
    .setIssuer(`https://api.workos.com/user_management/${env('WORKOS_CLIENT_ID')}`)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key)
  const sessionUser = {
    object: 'user', id: user.id, email: user.email, emailVerified: true, firstName: user.firstName,
    lastName: user.lastName, profilePictureUrl: null, lastSignInAt: now(), createdAt: now(), updatedAt: now(),
    externalId: null, metadata: {},
  }
  const sealed = await ironSession.sealData(
    { accessToken, refreshToken: `local-refresh-${user.id}`, user: sessionUser },
    { password: env('WORKOS_COOKIE_PASSWORD'), ttl: 0 }
  )
  process.stdout.write(`${sealed}\n`)
}

const [command, argument] = process.argv.slice(2)
if (command === 'serve') await serve()
else if (command === 'mint') await mint(argument ?? 'anna')
else {
  console.error('usage: node fake-workos.mjs serve | mint <user>')
  process.exit(2)
}

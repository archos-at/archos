import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthStrategy, Payload } from 'payload';
import { randomBytes } from 'node:crypto';
import { canUseAdminPanel } from '../access/roles';

export const EDGE_PERMISSION = 'platform:organizations:view';
export const EDGE_STRATEGY = 'edge-oidc';

type Env = Record<string, string | undefined>;

export interface EdgeSettings {
  issuer: string;
  adminEmail?: string;
}

export function edgeSettings(env: Env = process.env): EdgeSettings | undefined {
  const issuer = env.CMS_EDGE_OIDC_ISSUER?.trim().replace(/\/+$/, '');
  if (!issuer) return undefined;
  return { issuer, adminEmail: env.CMS_ADMIN_EMAIL?.trim().toLowerCase() || undefined };
}

export function bearerToken(headers: Headers): string | undefined {
  const value = headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() || undefined : undefined;
}

export function holdsPermission(claims: JWTPayload): boolean {
  const raw = claims.scope ?? claims.scp;
  const scopes = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(' ') : [];
  return scopes.includes(EDGE_PERMISSION);
}

export function newcomerRole(email: string, settings: EdgeSettings): 'admin' | 'editor' {
  return settings.adminEmail !== undefined && email === settings.adminEmail ? 'admin' : 'editor';
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const keysOf = (issuer: string) => {
  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`));
    jwks.set(issuer, keys);
  }
  return keys;
};

const emails = new Map<string, { email: string; until: number }>();

async function emailOf(issuer: string, token: string, claims: JWTPayload, fetchImpl: typeof fetch): Promise<string | undefined> {
  if (typeof claims.email === 'string') return claims.email.toLowerCase();
  const subject = claims.sub ?? '';
  const cached = emails.get(subject);
  if (cached && cached.until > Date.now()) return cached.email;
  const response = await fetchImpl(`${issuer}/oauth2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`userinfo answered ${response.status}`);
  const info = (await response.json()) as { email?: unknown; email_verified?: unknown };
  if (typeof info.email !== 'string' || info.email_verified === false) return undefined;
  const email = info.email.toLowerCase();
  emails.set(subject, { email, until: Date.now() + 5 * 60_000 });
  return email;
}

async function userFor(payload: Payload, email: string, settings: EdgeSettings) {
  const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true });
  const existing = found.docs[0];
  if (existing) return canUseAdminPanel(existing) ? existing : null;
  const role = newcomerRole(email, settings);
  const created = await payload.create({
    collection: 'users',
    data: { email, role, password: randomBytes(32).toString('base64url') },
    overrideAccess: true,
  });
  payload.logger.info(`created ${email} as ${role} on their first visit through the edge gate`);
  return created;
}

export function edgeStrategy(settings: EdgeSettings, fetchImpl: typeof fetch = fetch): AuthStrategy {
  return {
    name: EDGE_STRATEGY,
    authenticate: async ({ headers, payload }) => {
      const token = bearerToken(headers);
      if (!token) return { user: null };
      const verified = await jwtVerify(token, keysOf(settings.issuer), { issuer: settings.issuer }).catch(() => undefined);
      if (!verified || !holdsPermission(verified.payload)) return { user: null };
      const email = await emailOf(settings.issuer, token, verified.payload, fetchImpl);
      if (!email) return { user: null };
      const user = await userFor(payload, email, settings);
      if (!user) return { user: null };
      return { user: { ...user, collection: 'users', _strategy: EDGE_STRATEGY } };
    },
  };
}

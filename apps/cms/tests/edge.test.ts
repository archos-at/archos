import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Payload } from 'payload';
import { afterAll, beforeAll, test } from 'vitest';
import { bearerToken, EDGE_PERMISSION, edgeSettings, edgeStrategy, holdsPermission, newcomerRole } from '../src/auth/edge';
import { gatewayKeyGrants } from '../src/provision';

/** A stand-in for AuthKit: its JWKS, and a UserInfo that knows one person. */
let issuer = '';
let server: Server;
let sign: (claims: Record<string, unknown>, iss?: string) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/oauth2/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url === '/oauth2/userinfo' && req.headers.authorization?.startsWith('Bearer ')) {
      return res.end(JSON.stringify({ sub: 'user_1', email: 'Person@Example.com', email_verified: true }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sign = (claims, iss = issuer) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setSubject('user_1').setExpirationTime('5m').sign(privateKey);
});
afterAll(() => server.close());

/** The two Local API calls the strategy makes, over an in-memory users table. */
function fakePayload(users: Array<{ id: number; email: string; role: string }>) {
  const created: Array<Record<string, unknown>> = [];
  const payload = {
    find: async ({ where }: { where: { email: { equals: string } } }) => ({ docs: users.filter((u) => u.email === where.email.equals) }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const doc = { id: 100 + created.length, ...data };
      created.push(doc);
      return doc;
    },
    logger: { info: () => undefined },
  };
  return { payload: payload as unknown as Payload, created };
}

const headers = (value: string) => new Headers({ authorization: value });
const run = (strategy: ReturnType<typeof edgeStrategy>, payload: Payload, auth: string) =>
  strategy.authenticate({ headers: headers(auth), payload, isGraphQL: false, canSetHeaders: false, strategyName: 'edge-oidc' } as never);

test('the strategy is off without an issuer, and reads the admin e-mail in lower case', () => {
  assert.equal(edgeSettings({}), undefined);
  assert.deepEqual(edgeSettings({ CMS_EDGE_OIDC_ISSUER: 'https://x.authkit.app/', CMS_ADMIN_EMAIL: ' Boss@Example.com ' }), {
    issuer: 'https://x.authkit.app',
    adminEmail: 'boss@example.com',
  });
});

test("only a Bearer header is the edge's token; Payload's own headers are left to Payload", () => {
  assert.equal(bearerToken(headers('Bearer abc')), 'abc');
  assert.equal(bearerToken(headers('JWT abc')), undefined);
  assert.equal(bearerToken(headers('users API-Key abc')), undefined);
});

test('the permission is read from scope or scp, as the edge reads it', () => {
  assert.equal(holdsPermission({ scope: `openid email ${EDGE_PERMISSION}` }), true);
  assert.equal(holdsPermission({ scp: [EDGE_PERMISSION] }), true);
  assert.equal(holdsPermission({ scope: 'openid email platform:observability:view' }), false);
  assert.equal(holdsPermission({}), false);
});

test('a first visit makes an editor, or the administrator for CMS_ADMIN_EMAIL', () => {
  assert.equal(newcomerRole('a@example.com', { issuer, adminEmail: 'a@example.com' }), 'admin');
  assert.equal(newcomerRole('b@example.com', { issuer, adminEmail: 'a@example.com' }), 'editor');
  assert.equal(newcomerRole('b@example.com', { issuer }), 'editor');
});

test('a gated token signs in the CMS user with that e-mail, in the role the CMS gives them', async () => {
  const { payload, created } = fakePayload([{ id: 7, email: 'person@example.com', role: 'publisher' }]);
  const result = await run(edgeStrategy({ issuer }), payload, `Bearer ${await sign({ scope: `openid ${EDGE_PERMISSION}` })}`);
  assert.equal(result.user?.id, 7);
  assert.equal((result.user as { role?: string } | null)?.role, 'publisher');
  assert.equal(result.user?.collection, 'users');
  assert.equal(created.length, 0);
});

test("a person's first visit creates their CMS user", async () => {
  const { payload, created } = fakePayload([]);
  const result = await run(edgeStrategy({ issuer, adminEmail: 'person@example.com' }), payload, `Bearer ${await sign({ scope: EDGE_PERMISSION, email: 'Person@Example.com' })}`);
  assert.equal((result.user as { role?: string } | null)?.role, 'admin');
  assert.equal(created[0]?.email, 'person@example.com');
});

test('nothing without the permission, from another issuer, or for a robot account', async () => {
  const { payload } = fakePayload([{ id: 9, email: 'person@example.com', role: 'website' }]);
  const strategy = edgeStrategy({ issuer });
  assert.equal((await run(strategy, payload, `Bearer ${await sign({ scope: 'openid email' })}`)).user, null);
  assert.equal((await run(strategy, payload, `Bearer ${await sign({ scope: EDGE_PERMISSION }, 'https://elsewhere.example')}`)).user, null);
  assert.equal((await run(strategy, payload, `Bearer ${await sign({ scope: EDGE_PERMISSION })}`)).user, null);
  assert.equal((await run(strategy, payload, 'Bearer not-a-jwt')).user, null);
});

test("the gateway's key may do every operation the MCP server offers, and no delete", () => {
  const grants = gatewayKeyGrants();
  assert.deepEqual(grants.posts, { find: true, create: true, update: true });
  assert.deepEqual(grants.socialPosts, { find: true, create: true, update: true });
  assert.deepEqual(grants.socialAccounts, { find: true });
  assert.ok(Object.values(grants).every((ops) => !('delete' in ops)));
});

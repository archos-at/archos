/**
 * The hand-off sends a post to Buffer once, whatever fails around the send.
 * Both sides are faked behind `fetch`: a CMS that holds social posts and answers
 * Payload's REST, and a Buffer that creates and lists posts. Each test breaks one
 * step and runs the hand-off again.
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { handoff } from '../social/handoff.mjs';

const ENV = { CMS_URL: 'http://cms', CMS_SOCIAL_HANDOFF_API_KEY: 'k', SITE_URL: 'https://example.com', CMS_PUBLIC_URL: 'https://cms.example.com', BUFFER_API_KEY: 'b' };
const T0 = new Date('2026-11-11T10:00:00Z');
const LATER = new Date('2026-11-11T11:00:00Z');

type Doc = Record<string, unknown> & { id: number; status: string; updatedAt: string };
type BufferPost = { id: string; text: string; channelId: string; createdAt: string };
type Reply = { status: number; body: unknown };
type World = {
  docs: Doc[];
  bufferPosts: BufferPost[];
  /** Every `createPost` Buffer received: the count is the number of posts on the public channel. */
  created: number;
  now: Date;
  /** Answers a CMS PATCH instead of applying it, when it returns a reply. */
  failPatch?: (data: Record<string, unknown>) => Reply | undefined;
  /** Runs when Buffer receives `createPost`; `landed` says whether Buffer keeps the post. */
  onCreate?: () => { landed: boolean; reply?: Reply };
  failList?: boolean;
};

const account = { id: 1, key: 'linkedin-company', network: 'linkedin', maxLength: 3000, publisherChannelId: 'chan-1', active: true };
const post = (id: number, extra: Record<string, unknown> = {}): Doc => ({
  id, status: 'approved', language: 'de', text: 'Neu im Blog.', linkUrl: 'https://example.com/x/', blogPost: null, utmCampaign: null, image: null, scheduledAt: null, account, updatedAt: T0.toISOString(), ...extra,
});

function cmsReply(world: World, method: string, url: URL, body: Record<string, unknown> | undefined): Reply {
  if (method === 'GET') {
    const status = url.searchParams.get('where[status][equals]');
    return { status: 200, body: { docs: world.docs.filter((d) => d.status === status).map((d) => ({ ...d })) } };
  }
  const doc = world.docs.find((d) => String(d.id) === url.pathname.split('/').pop());
  if (!doc || !body) return { status: 404, body: {} };
  const failed = world.failPatch?.(body);
  if (failed) return failed;
  Object.assign(doc, body, { updatedAt: world.now.toISOString() });
  return { status: 200, body: { doc } };
}

function bufferReply(world: World, query: string, variables: { input?: { text: string; channelId: string } }): Reply {
  if (query.includes('createPost')) {
    world.created += 1;
    const { landed, reply } = world.onCreate?.() ?? { landed: true };
    const id = `buf-${world.created}`;
    if (landed && variables.input) world.bufferPosts.unshift({ id, text: variables.input.text, channelId: variables.input.channelId, createdAt: world.now.toISOString() });
    return reply ?? { status: 200, body: { data: { createPost: { post: { id } } } } };
  }
  if (world.failList) return { status: 200, body: { errors: [{ message: 'boom', extensions: { code: 'UNEXPECTED' } }] } };
  if (query.includes('organizations')) return { status: 200, body: { data: { account: { organizations: [{ id: 'org-1' }] } } } };
  return { status: 200, body: { data: { posts: { edges: world.bufferPosts.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } } } };
}

function fake(docs: Doc[]): World {
  const world: World = { docs, bufferPosts: [], created: 0, now: T0 };
  vi.stubGlobal('fetch', async (input: string, init: { method?: string; body?: string }) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const { status, body: answer } = url.host === 'cms' ? cmsReply(world, init.method ?? 'GET', url, body) : bufferReply(world, body.query, body.variables ?? {});
    return new Response(JSON.stringify(answer), { status });
  });
  return world;
}

/** One run at `now`; a run that dies is the case under test, so its rejection is swallowed. */
async function run(world: World, now: Date): Promise<string[]> {
  world.now = now;
  const lines: string[] = [];
  await handoff({ apply: true, env: ENV as unknown as NodeJS.ProcessEnv, now, log: (line: string) => lines.push(line) }).catch((error: Error) => lines.push(`died: ${error.message}`));
  return lines;
}

afterEach(() => vi.unstubAllGlobals());

test('a post whose record fails after the send is not sent again: the next run finds it in Buffer', async () => {
  const world = fake([post(1)]);
  world.failPatch = (data) => (data.status === 'scheduled' ? { status: 500, body: { errors: [{ message: 'database gone' }] } } : undefined);
  await run(world, T0);
  assert.equal(world.created, 1);
  assert.notEqual(world.docs[0].status, 'approved', 'a post that was sent no longer reads as waiting to be sent');

  world.failPatch = undefined;
  await run(world, LATER);
  assert.equal(world.created, 1, 'Buffer received the post once');
  assert.equal(world.docs[0].status, 'scheduled');
  assert.equal(world.docs[0].externalId, 'buf-1');
});

test('an answer that does not say whether Buffer took the post leaves it claimed, and the next run reads Buffer', async () => {
  const world = fake([post(1), post(2, { text: 'Zweiter.' })]);
  // The first post lands although the gateway answers 502; the second never arrives.
  const outcomes = [{ landed: true, reply: { status: 502, body: {} } }, { landed: false, reply: { status: 502, body: {} } }];
  world.onCreate = () => outcomes[world.created - 1];
  await run(world, T0);
  assert.deepEqual(world.docs.map((d) => d.status), ['sending', 'sending']);

  world.onCreate = undefined;
  await run(world, LATER);
  assert.equal(world.created, 2, 'neither post was sent a second time');
  assert.deepEqual(world.docs.map((d) => [d.status, d.externalId ?? null]), [['scheduled', 'buf-1'], ['failed', null]]);
  assert.match(String(world.docs[1].publishError), /Buffer holds no post/);
});

test('a claim another run made moments ago is left alone, and one Buffer cannot be asked about stays claimed', async () => {
  const world = fake([post(1, { status: 'sending' })]);
  const young = await run(world, new Date(T0.getTime() + 60_000));
  assert.equal(world.docs[0].status, 'sending');
  assert.match(young.join('\n'), /in flight/);

  world.failList = true;
  await run(world, LATER);
  assert.equal(world.docs[0].status, 'sending');
  assert.equal(world.created, 0);
});

test('a post Buffer refuses is failed with its reason, and a post another run claimed first is not sent', async () => {
  const world = fake([post(1), post(2)]);
  world.onCreate = () => ({ landed: false, reply: { status: 200, body: { data: { createPost: { message: 'Channel paused' } } } } });
  // The second post's claim is refused, as the CMS refuses it when another run holds the row.
  let claims = 0;
  world.failPatch = (data) => (data.status === 'sending' && ++claims === 2 ? { status: 409, body: {} } : undefined);
  await run(world, T0);
  assert.equal(world.created, 1);
  assert.deepEqual(world.docs.map((d) => d.status), ['failed', 'approved']);
  assert.equal(world.docs[0].publishError, 'Channel paused');
});

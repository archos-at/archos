# The local stack

The whole app on one machine: the workspace UI, its BFF and the agent backend,
signed in as a real user, with no Docker and no WorkOS account. Use it to click
through a change in the real product, to capture a screenshot of a page that
needs a session, or to drive the app with Playwright. A `/dev` preview route
needs none of this ([visual screenshots](../ux/visual-screenshots.md)); this is
for everything behind a session.

It works in a Claude Code cloud session, which has no Docker daemon. It was
first put together there by hand (2026-11-11), and is written down here so
nobody has to do that again.

## Start it

```bash
task setup          # once: the backend venv and the UI's node_modules
task local:up       # 35 to 75 s from nothing (measured); each page compiles on its first visit
task local:session -- anna    # prints a cookie value; see "A browser session"
task local:down     # stops it; the data stays for the next local:up
```

`task local:status` shows what runs. Everything else is
`scripts/local-stack/local-stack.sh <command>`; run it without a command for the
list.

`local:up` needs PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`,
or `PGBIN`), `redis-server`, `node`, `bun` and `curl`. A cloud session has all
of them.

## What runs

| Process | Port (variable) | Stands in for |
|---|---|---|
| Postgres 16, from the server binaries | 55432 (`LOCAL_STACK_PG_PORT`) | the CloudNativePG cluster. Migrated on every `up` by the deploy's own steps: `deploy/postgres/rename-legacy-names.sh`, `drizzle-kit migrate`, then the same script with `after-migrate` |
| `redis-server` | 56379 (`LOCAL_STACK_REDIS_PORT`) | Dragonfly (cache, conversation streams) |
| `scripts/local-stack/fake-workos.mjs` | 4010 (`LOCAL_STACK_WORKOS_PORT`) | the WorkOS API: a test double, described at the top of the file |
| backend, `PROCESS_ROLE=api` | 8000 (`LOCAL_STACK_API_PORT`) | the api tier |
| backend, `PROCESS_ROLE=chat` | 8001 (`LOCAL_STACK_CHAT_PORT`) | the chat tier (the WebSocket a turn runs on) |
| `next dev` | 3001 (`LOCAL_STACK_NEXT_PORT`) | the UI and the BFF |
| `server.js`, the gateway | 3000 (`LOCAL_STACK_UI_PORT`) | what the browser opens: proxies pages to `next dev` and `/websocket` to the chat role |

Everything binds to 127.0.0.1. `up` refuses to start when a port is held by a
process it did not start, before it starts anything.

Everything the stack writes goes to `LOCAL_STACK_DIR`: `/var/tmp/local-stack`
as root (the database server runs as `postgres`, which cannot enter `/root`),
`~/.local/state/local-stack` otherwise. Inside it: `postgres/` (the cluster and
its log), `redis/`, `backend/` (the backend's SQLite stores, which otherwise
land in the repository root), `logs/` (one file per process, and
`migrate.log`), `run/` (pid files) and the test double's signing key. Delete
the directory after `task local:down` to start from an empty database.

The UI runs from `LOCAL_STACK_UI_DIR` (default `apps/workspace`). `next dev`
writes its build output to `.next/` there and stages the pdf.js, Excalidraw
and MCP app assets as `bun run dev` does; all of it is gitignored.

## The users

One office, „Büro Testwerk“, with two members:

| User | Email | Role |
|---|---|---|
| `anna` | anna@testwerk.example | `admin` |
| `bert` | bert@testwerk.example | `admin` |

Both carry every organization permission an admin has. The office's feature
flags are every flag the registry marks `rollout`
(`apps/workspace/bff/authz/feature-flags.ts`, `FLAG_KINDS`) plus
`runtime-model-config`, so Organization → Models works. Add more with
`LOCAL_STACK_FLAGS=collaboration,deep-research`, set for `task local:down` and
`task local:up` alike, then mint a new session: the flags travel in the token
as well as in the test double's answers. Nobody is on
the platform organization, so the operator console stays closed.

## A browser session

There is no sign-in page. `task local:session -- anna` prints the value of a
sealed `wos-session` cookie, valid for 30 days, which AuthKit accepts as it
would one WorkOS issued: the test double serves the key it is signed with.

- **A browser by hand:** open `http://localhost:3000`, add a cookie named
  `wos-session` with that value for `localhost`, path `/`, and reload.
- **curl:** `curl -H "cookie: wos-session=$(task local:session -- anna 2>/dev/null)" http://localhost:3000/api/user/memory`
- **Playwright:** `context.addCookies([{ name: 'wos-session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])`
  before the first `goto`. `scripts/local-stack/smoke-memory.cjs` is the worked
  example, and `task local:smoke` runs it: anna adds a memory note on
  `/app/memory`, sees it after a reload, and bert sees none.

Navigate with `waitUntil: 'domcontentloaded'`, then wait for the control you
need. `networkidle` never arrives: the page keeps reconnecting to
`/api/stream` with a backoff for as long as it is open (the route answers 403
while the `collaboration` flag is off).

## A chat turn

Pages, projects, memory and settings work without a model. A chat turn needs
four more things:

1. **A provider key with credit.** `OPENROUTER_API_KEY` (or `OPENROUTER_KEY`)
   in the shell that runs `task local:up`. An account without credit answers
   402, and the chat shows only the generic „Bei der Recherche zu Ihrer Frage
   ist ein Fehler aufgetreten“; the reason is in `logs/chat.log`
   (`Error code: 402`).
2. **The model comes from the database, not from `DEFAULT_MODEL`.** On its
   first boot the UI fills `platform_model_defaults` with `openai/gpt-6-luna`
   for every agent group, once it can read the backend's config. An office's
   own choice (Organization → Models) wins over that row, and `DEFAULT_MODEL`
   applies only where neither exists. To pick a model for the office:
   `scripts/local-stack/local-stack.sh model <openrouter id>`, which sends the
   same request as the Models page.
3. **Zero data retention.** Every office is ZDR-only until it switches it off,
   and a free model has no ZDR endpoint, so its every call is refused
   (`No endpoints found matching your data policy` in `logs/chat.log`). Switch it
   off with `scripts/local-stack/local-stack.sh zdr off` (or on the Models
   page; both need `runtime-model-config`, which the stack grants).
4. **A Bundesland, for a building-law question.** With none set for the
   office, the agent closes the legal corpus for the turn and says so
   („Kein Bundesland für das Büro gesetzt“). Set it in the settings as anna.

A plain turn needs none of Qdrant, SeaweedFS, Hatchet, the public-source
fetcher, ClamAV or Langfuse.

## What is deliberately missing

- **Sign-in, sign-out and token refresh.** A session is minted, not signed
  into. When it expires, mint another.
- **WorkOS's decisions.** The test double answers every authorization write
  with success and stores nothing, so a project's sharing and role changes are
  not checked against WorkOS as in production.
- **The backend's own access checks.** The backend runs with
  `REQUIRE_AUTH=false` (only the UI checks sessions), so it does not check
  signed job scopes ([security-config.md](../deployment/security-config.md)).
- **Qdrant, SeaweedFS, Hatchet, ClamAV, the public-source fetcher, Langfuse.**
  Not started. Uploading or previewing a document, ingestion, retrieval over
  the corpus and traces do not work. Bring one up yourself and point its
  variable at it ([environment-variables.md](../deployment/environment-variables.md))
  when the change you are checking needs it.
- **Entitlement flags** other than `runtime-model-config`: off unless you add
  them with `LOCAL_STACK_FLAGS`.

## Two stacks on one machine

Next allows one `next dev` per directory (`.next/dev/lock`). When another stack
or a `bun run dev` already runs in `apps/workspace`, `up` stops with its pid.
Run the second stack from a copy, with its own ports and data directory:

```bash
scripts/local-stack/local-stack.sh copy-ui /var/tmp/ui-copy   # sources copied, node_modules hard-linked: seconds, no space
export LOCAL_STACK_UI_DIR=/var/tmp/ui-copy LOCAL_STACK_DIR=/var/tmp/local-stack-2
export LOCAL_STACK_PG_PORT=55442 LOCAL_STACK_REDIS_PORT=56389 LOCAL_STACK_WORKOS_PORT=4020
export LOCAL_STACK_UI_PORT=3010 LOCAL_STACK_NEXT_PORT=3011 LOCAL_STACK_API_PORT=8010 LOCAL_STACK_CHAT_PORT=8011
task local:up
```

Never run an install in either directory while they share `node_modules`. The
copy is a snapshot: copy again to pick up later edits. Mind the memory: see
the first row below.

## When it breaks

| Symptom | Cause | Do this |
|---|---|---|
| A `next-server` dies without a word, the gateway on the UI port goes with it, and `dmesg` says `Memory cgroup out of memory: Killed process … (next-server` | `next dev` grows to several GB as it compiles pages (4.7 GB seen), and each backend role takes about 0.7 GB. Two stacks beside test runs in a 16 GB cloud container is past the limit | One stack at a time, or stop the other work. `free -m` before `local:up` |
| `local:up` stops with `a next dev (pid …) already runs in …` | Another `next dev` holds the UI directory's lock | Stop it, or see [two stacks](#two-stacks-on-one-machine) |
| `local:up` stops with `port … is taken by another process` | A process the stack did not start holds the port | Find it with `ss -ltnp`, or move the stack's port with its variable |
| A page behind a session, or `/api/user/*`, answers 307 to a sign-in URL that never loads | No `wos-session` cookie, or one minted by another stack (another signing key) | Mint one with `local:session` for this stack and set it for `localhost` |
| `/app/memory` answers 500 and `/api/user/*` 403 on an app you started yourself with `REQUIRE_AUTH=false` | That mode has no session at all: every page behind `withPageSession` and every session route throws `SessionRequiredError`; only the `/dev` previews render | Use this stack, which runs with `REQUIRE_AUTH=true` and a minted session |
| The chat answers „Bei der Recherche … ist ein Fehler aufgetreten“ | The provider refused the call: 402 (no credit) or ZDR (`No endpoints found matching your data policy`) | Read `logs/chat.log`, then see [a chat turn](#a-chat-turn) |
| `migration failed` | A migration in the journal does not apply to the database you have, often after switching branches | `tail logs/migrate.log`. To start over: `local:down`, delete `LOCAL_STACK_DIR`, `local:up` |
| The backend logs `Internal API health check could not reach http://127.0.0.1:3000` at boot | The backend starts before the UI, on purpose | Nothing; it is a warning |
| A Playwright `goto` times out | `waitUntil: 'networkidle'` | `domcontentloaded`, then wait for a control |

Anything else: [gotchas.md](gotchas.md), searched for the message you see.

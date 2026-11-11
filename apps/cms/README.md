# The website's CMS

Payload 3, self-hosted, in its own Next.js app ([ADR-0155](../../docs/adr/0155-the-website-blog-is-edited-in-a-self-hosted-payload.md)):
where the team writes, reviews and publishes the website's blog posts and drafts
their LinkedIn posts. The website reads published posts from it on request
(`apps/website/src/lib/cms.ts`), so publishing needs no build and no deploy.

Everything Payload is configured with is code here, changed by pull request:

| Path | What it is |
|---|---|
| `src/payload.config.ts` | The wiring: database, storage, localisation (de, en), jobs, the MCP plugin, provisioning on start |
| `src/collections/` | Posts, media, authors, social posts and accounts, users |
| `src/access/` | Who may do what: `roles.ts` (the role table), `editorial.ts` (the review step for posts), `social.ts` (the approval of social posts) |
| `src/blocks/` | The blocks a post's body is made of: `post-blocks.ts` (figures, image, screenshot, gallery, callout, quote, call to action, code, the abbreviation inline block), `content-blocks.ts` (the blocks whose contracts live in `apps/website/src/components/blocks`) |
| `src/fields/` | The body's editor (`post-body.ts`) and the values the website owns in code (`choices.ts`) |
| `src/hooks/`, `src/jobs/` | Telling the website what is live changed; drafting LinkedIn posts on publish |
| `src/preview.ts` | The signed live-preview links and the endpoint the website's preview page reads |
| `src/mcp.ts` | What the MCP server offers |
| `src/provision.ts` | The first administrator, the robots' API keys, the LinkedIn account, on every start |
| `src/migrations/` | The database schema's history, applied when a production server starts |
| `scripts/import-blog.ts` | Imports the MDX posts of `apps/website/src/content/blog`, keyed by slug |
| `social/` | The UTM convention, the hand-off of approved social posts to Buffer, drafts from the weekly release summaries |

## The model

- **Posts** hold both languages in one document: title, description, slug, body,
  SEO fields and former slugs per language; publish date, category (`product`,
  `practice`, `technology`, as `apps/website/src/lib/categories.ts`), cover (a line
  drawing by id, or an uploaded image with alt text per language) and author once.
  Drafts, versions, autosave and scheduled publishing are on. `stage` says whether
  an editor wants a review.
- **The body** is Lexical rich text: headings (h2 to h4), paragraphs, bold, italic,
  strikethrough, inline code, links, lists, quotes, tables, rules, and blocks. Each
  block is a design-system component with its props as fields. There is no block
  for raw HTML or MDX.
- **Social posts**: one text for one account in one language, the blog post or link
  it carries, a UTM campaign, an optional image, a time, and a status
  (`draft`, `in_review`, `approved`, `sending`, `scheduled`, `published`, `failed`,
  `archived`). `sending` is the hand-off's claim: it is set before a post goes to
  Buffer, so an interrupted hand-off is looked up there on the next run and never
  sent a second time. Once a post is `sending`, `scheduled` or `published` its
  content is locked; the way back is `failed`, then edit and approve again.
- **Media**: images only (no SVG), in the sizes the website asks for, cut at the
  focal point you set. Files are public by URL.

## Who may do what

| Role | May |
|---|---|
| Administrator | Everything, and manage users and API keys |
| Publisher | Publish, unpublish, schedule, restore a version onto the live post, delete; approve social posts |
| Editor | Write drafts (also of a live post: the change waits as a draft), set "ready for review" |
| Agent | What an editor may, through the API or MCP; no admin panel |
| Website | Read what is live (its API key) |
| Social hand-off | Read approved and `sending` social posts; claim one as `sending`, then mark it scheduled or failed (its API key) |

The rules are on the collections (`src/access/`), so the admin panel, REST, the
MCP server and scheduled publishing all meet them. `tests/` and `tests/int/` hold
them.

**Sign-in.** On a cluster the CMS host sits behind the same WorkOS gate as
Langfuse: only platform staff (the `platform:organizations:view` permission) get
past it, and the CMS signs them in from the token the gate forwards
(`src/auth/edge.ts`), with no second sign-in. A first visit creates the person's
CMS user as an editor, or as the administrator for `CMS_ADMIN_EMAIL`; after that
the role is whatever an administrator sets. The images (`/api/media/file/`) are
the one open path, because the website's visitors load them. Where there is no
gate (locally), people sign in with a password: 12 characters at least, five
attempts then 15 minutes locked, eight-hour sessions.

## Agents

The MCP server (`/api/mcp`) offers find, create and update on posts, authors and
social posts, find on accounts and media, and no delete. On a cluster agents reach
it through the platform MCP gateway, signed in with WorkOS as a platform owner
([`platform-mcp-gateway.md`](../../docs/deployment/platform-mcp-gateway.md)):

```bash
claude mcp add --transport http cms https://platform-mcp.<baseDomain>/cms/mcp
```

The gateway presents the MCP key of an agent account the deployment provisions
(`CMS_PLATFORM_MCP_API_KEY`, `src/provision.ts`), so every write is a draft a
publisher reviews. The CMS host itself takes no key from outside: the gate stands
in front of it. Locally, a key made under Settings > API Keys works directly:
`claude mcp add --transport http cms http://localhost:3100/api/mcp --header "Authorization: Bearer <key>"`.

## Adding a block

1. Its config: a `Block` in `src/blocks/post-blocks.ts` (or `content-blocks.ts`),
   its fields named as its component's props, added to `POST_BLOCKS` (or
   `POST_INLINE_BLOCKS`). Then `bun run generate` for the types.
2. Its renderer: its props in `BLOCK_PROPS` (`apps/website/src/lib/post-blocks.ts`;
   a block with a contract in `apps/website/src/components/blocks/contracts.ts`
   uses its parser) and its line in `apps/website/src/components/PostBlock.astro`.

No migration: the body is one JSON column. `apps/website/src/lib/rich-text.test.ts`
fails a block one side has and the other does not, and `tests/choices.test.ts`
fails a contracted block that is not registered.

## Locally

```bash
task cms:dev           # the CMS on http://localhost:3100 against a throwaway Postgres, gone when you stop it
task cms:up            # or the Compose profile `cms`, which keeps its data (deploy/compose)
DATABASE_URL=… PAYLOAD_SECRET=… task cms:import -- apply   # the MDX posts
cd apps/website && CMS_URL=http://localhost:3100 CMS_API_KEY=local-website-key CMS_PUBLIC_URL=http://localhost:3100 bun run dev
```

Admin panel: http://localhost:3100/admin, `admin@example.com` / `local-admin-password`.

## Changing the model

Change the collection, then write its migration against a throwaway database and
commit both:

```bash
bun run test:db -- npx --no-install payload migrate:create <what-changed>
bun run generate   # the types and the admin panel's import map
```

`task cms:test:db` fails when the config and the migrations disagree. A production
server applies new migrations when it starts.

**Upgrade.** Every `payload` and `@payloadcms/*` package moves to the same version
in one change (Dependabot groups them); `task cms:verify` and a look at Payload's
release notes for migrations.

## Social posts

When a post is published, a job drafts one LinkedIn post per language. A person
edits it, a publisher approves it; `social/handoff.mjs` (dry run by default) hands
every approved post to Buffer, with the link tracked by the UTM convention in
`social/links.mjs` and the blog post's share image. `social/release-summaries.mjs`
drafts posts from a week of `releasenotes/summaries.yaml`.

Not running anywhere yet: the hand-off needs a Buffer account with the LinkedIn page
connected, its API key, and a schedule (ADR-0155, "What the owner has to decide").

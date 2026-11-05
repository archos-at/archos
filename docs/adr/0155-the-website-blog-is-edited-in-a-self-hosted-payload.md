---
status: proposed
date: 2026-11-05
decision-makers: product owner (Matthias)
consulted: Grid engineering
informed: everyone working in this repo
---

# The website's blog is written in a self-hosted Payload and read on request; social posts are drafted there and published through Buffer

## Context and Problem Statement

The public website's blog lives in git: one MDX file per post and language in
`apps/website/src/content/blog`, with figures as Astro components imported into
the file. Writing a post means a branch, a pull request, a review, a build and a
deploy; fixing a typo means the same. Nobody outside engineering can do it, and
the twins of a post are paired by a slug typed by hand (`translationSlug`), which
nothing checks. The owner wants the team to write and publish without a code
change or a deploy, wants agents (Claude, our own agent) to draft and translate
with a person approving, and wants the same place to carry the company's
LinkedIn posts, measured in PostHog.

ADR-0145 and `docs/contributing/ai-native-tooling.md` set the bar for any tool
we adopt: an agent must be able to read, create, edit and publish through a
first-class surface, configuration must be code, and an agent's edit must land
behind review with a history to roll back from.

The first version of this record chose Directus 12 and built it (deployment,
sync files, import, website reader). Measured before it shipped, it failed two
of the drivers below, and the owner replaced it with Payload on 2026-11-05:

* **The review step is licensed.** Directus 12 without a license key runs its
  core tier and refuses every permission with a rule or a field list, which is
  what "an editor drafts, only a publisher publishes" is made of (local 12.6.1,
  2026-11-05: `RESOURCE_RESTRICTED custom_permission_rules_enabled`). The free
  Open Innovation Grant is per year and per URL; the owner wants a licence with
  no feature walls.
* **Its image failed our scan.** `directus/directus:12.6.1` carried HIGH CVEs
  with fixed versions available (undici 6.28.0, brace-expansion 5.0.9), which
  the "changed pins" trivy job refuses; a vendor image is patched on the vendor's
  schedule.
* **The review step had a hole.** A post's body blocks were separate items, and
  the drafting policy could change a live block through the API behind the
  review (the old record's own "Bad" list).

## Decision Drivers

* Publishing without a build or a deploy, within a minute.
* A real draft, review, publish workflow with roles; an agent never publishes,
  never edits what is live, never deletes.
* AI-native (`docs/contributing/ai-native-tooling.md`): an official MCP server,
  scoped credentials, schema and configuration as code, revisions.
* Self-hosted, in our cluster in the EU, on the data stack we already run
  (CloudNativePG, SeaweedFS); no content in a third party's database.
* A licence without feature walls on what we need: roles and rules, drafts,
  versions, scheduling, localisation, MCP.
* An image we build and patch ourselves, scanned like our other apps.
* Editors can do at least everything the MDX posts do: headings, lists, links,
  tables, quotes, code, every figure the posts use, images, galleries, calls to
  action; nothing that runs (no raw HTML, no MDX).
* The website's rules hold: design-system components only, CSP `script-src
  'self'`, WCAG 2.2 AA, sitemap, RSS, hreflang, structured data, an offline
  build that needs no CMS.

## Considered Options

For the CMS:

1. **Payload 3, self-hosted**, as its own Next.js app in `apps/cms`.
2. **Directus 12, self-hosted** (built first; dropped, see above).
3. **Strapi 5, self-hosted.**
4. **Wagtail, self-hosted.**
5. **Sanity** (hosted).
6. **Keep git**, with or without a git-backed editor (Keystatic, Decap).

For reading the content on the website:

* **A. Server-rendered blog routes** that read the CMS on request, with an
  in-memory stale-while-revalidate copy and a publish hook that refreshes it.
* **B. Build-time fetch** and a publish hook that triggers a rebuild and deploy.

For publishing social posts:

* **i. Buffer** (API and remote MCP server), handed approved posts from the CMS.
* **ii. LinkedIn's Posts API directly.**
* **iii. Hootsuite or Publer.**
* **iv. By hand** from the CMS.

## Decision Outcome

Chosen: **Payload 3 self-hosted (1)**, in its own app `apps/cms` deployed to its
own namespace at `cms.<baseDomain>`, read by **server-rendered routes (A)**, with
social posts drafted and approved in Payload and handed to **Buffer (i)**,
because Payload is MIT-licensed with drafts, versions, scheduled publishing,
localisation, access control as code and an official MCP plugin in the core
(Enterprise adds SSO, approval workflows, a visual editor and AI features, none
of which this design needs), its configuration is TypeScript in our repository,
it runs on Postgres and S3 through first-party adapters, and it is a Next.js app
we build into our own image like `apps/workspace`.

Not inside `apps/workspace`: the CMS has its own users and sign-in, its own
upgrade cadence (Payload pins its Next.js range), and a public admin panel whose
blast radius should not include the offices' data.

### The north star

An editor (or Claude or our agent, through the CMS's MCP server, as an account
whose rights are a drafter's) writes a post in German. The English translation is
drafted next to it. The editor marks it ready for review; the publisher opens it
in the website's live preview, beside the form, and publishes it or schedules it
for a date. On publish the website shows it within seconds, with its share card,
in the sitemap, the feed and `llms.txt`; LinkedIn drafts for both languages
appear, the publisher approves them, and Buffer posts them at their time with
tracked links whose visits PostHog attributes. The team composes posts in a rich
editor whose blocks are the design system's components (figures, images,
galleries, charts, key figures, before and after, legal sources, Q&A excerpts,
callouts, calls to action), and edits other parts of the site the same way (home
sections, FAQ, team, pilot offices). Editors sign in with the office's WorkOS
identity and its second factor.

### What lands now, and what each slice serves

| Slice | What | Serves | State |
|---|---|---|---|
| 1 | The app (`apps/cms`): Payload 3.93.0 on Next 16.4.5, Postgres adapter with migrations applied when the server starts (`prodMigrations`), files on SeaweedFS (`@payloadcms/storage-s3`, bucket `cms-files`, identity `cms`), image sizes cut at a focal point, the admin panel in German and English, provisioning of the first administrator, the website's key and the LinkedIn account on start (`src/provision.ts`) | the whole star | built; `next build`; served from its standalone output against Postgres |
| 2 | The model: posts with both languages in one document, cover by drawing id or uploaded image, category, author, SEO fields, former slugs; drafts, versions (100 per post), autosave, scheduled publish and unpublish (the jobs queue, run in the server once a minute); social posts and accounts | review, translation | built; integration suite on Postgres |
| 3 | The review step in code (`src/access/`): roles admin, publisher, editor, agent, website, social hand-off; every write of an editor or an agent is a draft save, by a `beforeOperation` hook that every path runs (admin panel, REST, Local API, MCP, scheduled publish); only a publisher publishes, unpublishes, restores onto the live post, deletes or approves a social post; the website's key reads what is live and due | review, agents | built; unit, Postgres and HTTP tests (below) |
| 4 | The body: Lexical rich text (headings h2-h4, bold, italic, strikethrough, inline code, links, lists, quotes, tables, rules) with BlocksFeature blocks typed as their component's props: the four figures the posts use (isometric stack, nested scopes, hybrid retrieval, lesson loop), image, product screenshot, gallery, callout, person quote, call to action, code, and the seven contracted blocks of `apps/website/src/components/blocks` (chart, key figures, before and after, annotated image, legal source, Q&A excerpt, key takeaways); an abbreviation as an inline block. No raw HTML, no MDX | richness, safety | built; every node and block rendered and checked (below) |
| 5 | MCP (`@payloadcms/plugin-mcp`, `POST /api/mcp`): find, create, update on posts, authors, social posts; find on accounts and media; no delete; no users, keys or jobs; experimental tools off. Keys bound to a user: a person makes their own, an administrator makes an agent account's | agents | built; drafts through MCP, publish refused, delete absent |
| 6 | Import of the MDX posts into this structure through the Local API, keyed by slug, idempotent, an editor's later change kept (`scripts/import-blog.ts`) | the cutover | built; run twice on an empty database; 12 of 12 published posts render the same HTML from the CMS as from MDX |
| 7 | The website reads the CMS on request, falls back to the MDX fixtures without one (`apps/website/src/lib/{posts,cms,post-model,rich-text,post-blocks}.ts`, `RichText.astro`, `PostBlock.astro`, `/sitemap-blog.xml`, `/api/cms/revalidate`) | publishing without a deploy | built; build, a11y, routes, structured data pass in both modes |
| 8 | Live preview: the admin panel frames `/blog/preview/` with a link the CMS signs (HMAC, one hour); the page asks the CMS for exactly that draft, holds no credential that reads drafts, may be framed by the CMS's origin only, and reloads on every save | review | built |
| 9 | Deployment as code (`deploy/pulumi/src/platform/cms*.ts`, `data/cms-pg.ts`, `config/cms.ts`): image `cms` built by CI, namespace `cms`, `cms-pg`, read-only root, NetworkPolicies; Compose profile `cms` | the whole star | built; manifest spec; **off** until `cmsEnabled` |
| 10 | Social: model, UTM convention, Buffer hand-off with a dry run, LinkedIn drafts on publish (a job), drafts from the weekly release summaries | LinkedIn | built and tested offline; not running: no Buffer account yet |
| 11 | Editors sign in through WorkOS (a Payload custom auth strategy: AuthKit's session cookie to a CMS user by e-mail, roles from the CMS), and AuthKit's MFA is the second factor | sign-in | next; until then local sign-in with lockout, 12-character passwords, eight-hour sessions, `SameSite=Strict` `Secure` cookies, no self-registration |
| 12 | The deploy pipeline resolves the `cms` image per service like the other three (`deploy/pulumi/scripts/resolve-image-refs.sh`, `deploy.yml`); today it follows `imageTag`, which a CI-triggered deploy sets to a commit CI tagged for all images | operations | next, before `cmsEnabled` on staging |
| 13 | Site pages beyond the blog in the CMS by the same blocks: home sections, FAQ, team, pilot offices (globals and collections). Not the legal pages (their review is a pull request, on purpose) and not the changelog (ADR-0154) | team edits the site | later |
| 14 | A translation drafted by an agent when a post is created (a job, our agent through MCP) | translation | later |

### How the review step is enforced

The rules are on the collection, not in a screen, so every path a write can
take meets them:

* **Drafts only for drafters.** `draftsUnlessPublisher` (`src/access/editorial.ts`)
  is a `beforeOperation` hook. For a user who drafts but does not publish, it sets
  `draft: true` on every create and update, which Payload writes to the versions
  table alone; the live document is untouched, and an editor's or an agent's
  change to a published post waits as its newest draft. A request to publish
  (`_status: 'published'`) is refused with 403, not downgraded. A restore of a
  version onto the live post is refused (restore reads its own `draft` flag
  before the hook; "restore as draft" works).
* **The admin panel agrees.** `writePosts` is the update access with the data
  Payload passes: it refuses `_status: 'published'` to a drafter, which is also
  how the admin panel decides to hide Publish and Unpublish.
* **One document, no side doors.** A post's body is a field of the post, so no
  block can be changed on its own behind the review (the Directus hole).
* **Scheduling runs as the scheduler.** Payload's scheduled-publish job publishes
  as the user who scheduled it, through the same rules: an editor's schedule
  fails, a publisher's goes live (Postgres suite).
* **Deletes.** Only a publisher deletes; the MCP server offers no delete at all.
* **Social posts.** `guardSocialStatus` (`src/access/social.ts`) is the
  transition table: drafters move a post between draft and in review, only a
  publisher approves, the hand-off only moves an approved post to scheduled or
  failed and may write nothing but what it records.
* **Roles are granted.** Only an administrator sets a role; the first account
  ever created is the administrator.

### How the website reads it (option A)

The blog's routes (`/blog/`, `/blog/<segment>/`, the English twins, both feeds,
`/sitemap-blog.xml`, `/llms.txt`) are rendered on request by the existing Node
server. With `CMS_URL` and `CMS_API_KEY` the posts come from Payload's REST API:
one request for every live post with both languages (`locale=all`), filtered to
published and due in the query as well as by the key's rights, kept in memory for
60 s and served stale while one request refreshes it; the last good copy is kept
when the CMS is down. The CMS calls `POST /api/cms/revalidate` when what is live
changes (a publish, an unpublish, a delete; not a draft save). Each web pod keeps
its own copy, so a publish is visible at once on the pod the CMS reached and
within 60 s on the others. Without `CMS_URL` the same routes serve the MDX files
in `src/content/blog`, now fixtures, so every check runs without a CMS.

The body is rendered node by node (`RichText.astro`): texts through Astro's
escaping, links through an allow-list of schemes, blocks through
`PostBlock.astro`, which maps each block to its design-system component. The
markup is the MDX pipeline's for the same content (heading ids by
github-slugger, nested lists, a link's shared marks outside it), measured: the
12 published fixture posts render byte-identical bodies (after whitespace) from
MDX and from the CMS. Images are served by the CMS in its sizes from
`cms.<baseDomain>`, the only origin added to `img-src`.

**Adding a block** is one config and one renderer entry: the block in
`apps/cms/src/blocks/` (its fields are its component's props), its props in
`BLOCK_PROPS` (`apps/website/src/lib/post-blocks.ts`; for a block with a
contract in `src/components/blocks/contracts.ts`, its parser is its props), and
its line in `PostBlock.astro`. A test on each side fails a block the other does
not know. No migration: the body is one JSON column.

**Covers.** A post's cover is a line drawing by id (the drawings stay
code-reviewed SVGs in `apps/website/src/assets/covers`, and the CMS's choices are
held to that folder by a test) or an uploaded image with alt text, focal point
and an AI flag, cropped to the card's 3:2 and the share card's 1200 x 630. No
SVG uploads: an SVG can carry script.

### Social posts

Unchanged from the first version of this record, except where the data lives:
`social-posts` hold one post for one account in one language, with its text
(3000 characters), the blog post or link it carries, a UTM campaign, an optional
image, a time and a status (`draft`, `in_review`, `approved`, `scheduled`,
`published`, `failed`, `archived`). Nothing is posted without a publisher's
approval. When a post is published, a job drafts one LinkedIn post per language
(keyed by `blog-post:<id>:<locale>`, never twice). `apps/cms/social/handoff.mjs`
turns each approved post into Buffer's `createPost` with the share image and the
tracked link (`utm_source` the network, `utm_medium=social`, `utm_campaign` the
slug or the post's own, `utm_content` the account and the post), and is a dry run
until a Buffer key exists. LinkedIn's Posts API scrapes no preview, so the image
is sent: a drawing's band rendered to `/media/covers/<id>.png`, or an image
cover's `share` size.

### Consequences

* Good, because a publisher publishes, unpublishes and schedules without
  engineering, and the website shows it within a minute (measured locally:
  616 ms from publish to the listing).
* Good, because the review step is code in our repository, reviewed in pull
  requests and proven by tests on the operations every client uses, with no
  licence key.
* Good, because the twins of a post are one document: hreflang can no longer
  point at a slug nobody checked.
* Good, because agents work through the official MCP plugin with exactly the
  rights of the account their key is bound to; an agent account can draft and
  nothing else.
* Good, because editors get a rich editor whose every block is a design-system
  component, and nothing they can type runs on the page.
* Good, because the image is ours: built from `node:22-slim` each week by CI,
  scanned and deployed like `apps/website`.
* Bad, because the CMS is now an app of ours to build, upgrade and patch:
  Payload moves fast (3.90 to 3.93 in seven weeks), its packages move in
  lockstep (one Dependabot group), and Payload 4 is in beta.
* Bad, because it is a stateful service to run: a Postgres cluster and its
  backups (off until `cmsPgBackupsEnabled`).
* Bad, because the blog's pages are rendered on request: a CMS outage on a cold
  pod is a 500 on the blog until it answers.
* Bad, because Payload's sign-in has no second factor of its own; until the
  WorkOS slice, the admin panel rests on passwords, lockout and short sessions.
* Bad, because uploaded files are public by URL, including one uploaded for a
  draft that is not live yet.
* Neutral: MCP keys are static bearer keys a person creates, not OAuth; the
  plugin's `overrideAuth` takes OAuth later.

### Confirmation

* `apps/cms/tests/` (unit, `task cms:test`): the role table, the publish rule,
  the website's filter, the social transitions, the MCP surface (no delete, no
  users or keys); the cover, category, call-to-action and contracted-block lists
  equal the website's code; every MDX post converts, twins pair, figures become
  their blocks with a field per prop.
* `apps/cms/tests/int/` (Postgres, `task cms:test:db`, CI's CMS job): migrations
  on an empty database as a plain owner; the config agrees with the migrations;
  editors and agents draft and cannot publish, unpublish, restore onto the live
  post, delete or approve; their change to a live post waits as a draft; the
  website reads only what is live and due; a scheduled publish runs as its
  scheduler; publishing drafts the LinkedIn posts once; the first administrator,
  the robots and the account are provisioned idempotently.
* `apps/website/src/lib/{cms,rich-text}.test.ts`: the query asks for live posts
  only; links pass the scheme allow-list; every CMS block has props and a
  component; a contracted block is parsed by its contract.
* `deploy/pulumi/index-cms.spec.ts`: listener, route, image, read-only root,
  secrets out of the pod spec, verified database certificate, network policies,
  the S3 identity's single bucket, no config Job.
* Checked by hand on 2026-11-05 against a local CMS (standalone server, Postgres
  16): 21 REST and MCP checks; the import twice; 12 of 12 published posts
  identical; every node and block of a showcase post rendered; `check:a11y` on
  the CMS-served blog; the signed preview, its framing, and a forged link's 404.

## Pros and Cons of the Options

### Payload 3, self-hosted

* Good, because the core is MIT (`LICENSE.md`, "Copyright (c) 2018-2026 Payload
  CMS, LLC", read 2026-11-05) and drafts, versions, autosave, scheduled publish,
  localisation, live preview, the jobs queue, access control and the MCP plugin
  are in it (payloadcms.com/docs: versions/drafts, live-preview, jobs-queue,
  plugins/mcp, read 2026-11-05).
* Good, because collections, access rules and hooks are TypeScript we review,
  and schema changes are migrations a test holds to the config.
* Good, because the MCP plugin uses the Local API with the key's user and
  `overrideAccess: false` (read in `@payloadcms/plugin-mcp` 3.93.0's source), so
  our rules apply to agents unchanged.
* Bad, because Enterprise holds SSO (as a plugin), publishing workflows
  (approvals), the visual editor and AI features (payloadcms.com/enterprise, read
  2026-11-05). Our review step is our access code instead; SSO is a custom auth
  strategy, which the core supports.
* Bad, because Payload's own Markdown converter flattens nested lists (measured
  on 3.93.0), so the import carries its own converter.

### Directus 12, self-hosted

* Good, because it runs from the vendor's image with an official CLI for
  configuration as files and a built-in MCP server with OAuth.
* Bad, because the review step needs a licence (core tier refuses permission
  rules, verified on 12.6.1), the core tier caps Studio seats at 3, collections
  at 25 and flows at 5, the image failed our CVE scan, and a body block was
  editable behind the review.

### Strapi 5

* Bad, because review workflows and audit logs are Enterprise-only, and content
  history is 14 days on the paid Growth plan (strapi.io/pricing-self-hosted, read
  2026-11-05).

### Wagtail

* Good, because it is BSD-licensed with moderation workflows in the core.
* Bad, because it is a Django app beside our TypeScript and Python stacks, and it
  has no first-party MCP server: the packages found are third-party, one calling
  itself an early prototype (pypi.org/project/wagtail-mcp, read 2026-11-05).

### Sanity

* Bad, because content lives in Sanity's hosted content lake, outside our
  cluster and outside Vienna, and the owner chose self-hosting in the EU.
* Premise: that choice. If it changes, Sanity's MCP server and GROQ make it a
  candidate.

### Keep git (with Keystatic or Decap)

* Bad, because every publish is still a build and a deploy, the problem.

### B. Build-time fetch and a rebuild per publish

* Bad, because a publish waits for CI and a deploy and ties content to the
  release train.

### ii. LinkedIn's Posts API directly

* Bad, because posting as a company page needs the Community Management API, a
  vetted product with app review, token refresh and versioned headers we would
  own (Microsoft Learn, "Community Management App Review", updated 2026-02-11;
  "Posts API", updated 2026-05-13).
* Premise: Buffer stays available on our plan with LinkedIn pages.

### iii. Hootsuite or Publer

* Not evaluated in depth: Buffer's API and MCP are on every plan including Free
  (Buffer, 2026-05-27).

### iv. By hand

* Good, because it needs nothing. It is the state until the Buffer key exists.

## More Information

### AI-native check: Payload (2026-11-05)

| # | Criterion | Result | Evidence (source, date) |
|---|---|---|---|
| 1 | Official agent surface | yes: `@payloadcms/plugin-mcp` (find, create, update, delete per collection, each switchable per key; custom tools, prompts, resources), REST, GraphQL (off here), the Local API | payloadcms.com/docs/plugins/mcp, 2026-11-05; npm `@payloadcms/plugin-mcp` 3.93.0 (2026-11-04) |
| 2 | Scoped credentials | yes: API keys per user, acting with that user's rights; MCP keys switch each operation on or off | plugin source 3.93.0; our HTTP checks, 2026-11-05 |
| 3 | Schema and configuration as code | yes: `apps/cms/src`, migrations in `src/migrations`, applied on start | the Postgres suite's drift gate |
| 4 | Audit and rollback of agent edits | yes: an agent's write is a draft version; every save is a version (100 per post); restore by version | Postgres suite, 2026-11-05 |
| 5 | Events | yes: hooks in our code (revalidate, social drafts), the jobs queue | `src/hooks`, `src/jobs` |
| 6 | CLI | yes: `payload` (migrate, generate, run) | |
| 7 | Exit | yes: Postgres tables we own, files in our bucket, the schema in git | |

Round trip done by: Claude Code (this change), 2026-11-05, on a local Payload
3.93.0 (standalone server) with Postgres 16: an administrator issued an MCP key
to an agent account; through MCP the agent created a post (a draft), edited it,
was refused publishing it, and found no delete tool; the post stayed a draft.
Exceptions: none.

### AI-native check: Buffer (2026-11-05)

Unchanged from the first version of this record: a remote MCP server and a
GraphQL API (developers.buffer.com, 2026-05-27); an API key per account with no
read-only scope; the approval is ours, in the CMS; agents get no Buffer write
access. Round trip not done (no account).

### What the owner has to decide or obtain

1. The CMS host: `cms.<baseDomain>` by default (`cmsDomain`); DNS follows the
   listener when `dnsEnabled`.
2. An off-cluster bucket for `cms-pg`'s PITR archive (`cmsPgBackup*`) before the
   first post is written there.
3. Buffer: an account (Free has 3 channels), the LinkedIn page connected by a
   page admin, its channel id on the account in the CMS, an API key as a secret,
   and where the hand-off runs (a CronJob beside the CMS, or a job in it).
4. The WorkOS sign-in slice (11): a redirect URI on the CMS host in WorkOS, and
   which organisation's members may edit.
5. Turning it on: `cmsEnabled` on staging, after slice 12.

### Revisit when

* Payload 4 is released: its migration is a change of its own.
* Publishing needs to reach every web pod at once (more pods, a CDN): move the
  copy to Dragonfly or Astro's route cache.
* Buffer drops LinkedIn pages or the API from our plan.

Sources, read 2026-11-05: npm registry (`payload` 3.93.0 published
2026-11-04T15:04Z, `@payloadcms/plugin-mcp` 3.93.0, `4.0.0-beta.7`),
github.com/payloadcms/payload (`LICENSE.md`; `templates/blank` at v3.93.0),
payloadcms.com/docs (plugins/mcp, versions/drafts), payloadcms.com/enterprise,
strapi.io/pricing-self-hosted, pypi.org/project/wagtail-mcp, the source of
`payload`, `@payloadcms/plugin-mcp` and `@payloadcms/ui` 3.93.0 as installed;
for Directus, the first version of this record (local 12.6.1, the trivy job's
report); Microsoft Learn (LinkedIn Posts API, Community Management), Buffer
(developers.buffer.com, buffer.com/resources/buffer-api-is-here, 2026-05-27).

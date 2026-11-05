---
status: proposed
date: 2026-11-05
decision-makers: product owner (Matthias)
consulted: Grid engineering
informed: everyone working in this repo
---

# The website's blog is written in a self-hosted Directus and read on request; social posts are drafted there and published through Buffer

## Context and Problem Statement

The public website's blog lives in git: one MDX file per post and language in
`apps/website/src/content/blog`, with figures as Astro components imported into
the file. Writing a post means a branch, a pull request, a review, a build and a
deploy; fixing a typo means the same. Nobody outside engineering can do it, and
the twins of a post are paired by a slug typed by hand (`translationSlug`), which
nothing checks (`apps/website/AGENTS.md` said so). The owner wants the team to
write and publish without a code change or a deploy, wants agents (Claude, our
own agent) to draft and translate with a person approving, and wants the same
place to carry the company's LinkedIn posts, measured in PostHog.

ADR-0145 and `docs/contributing/ai-native-tooling.md` set the bar for any tool
we adopt: an agent must be able to read, create, edit and publish through a
first-class surface, configuration must be code, and an agent's edit must land
behind review with a history to roll back from.

## Decision Drivers

* Publishing without a build or a deploy, within a minute.
* A real draft, review, publish workflow with roles; an agent never publishes.
* AI-native (`docs/contributing/ai-native-tooling.md`): an official MCP server,
  scoped tokens, schema and configuration as code, revisions.
* Self-hosted, in our cluster in the EU, on the data stack we already run
  (CloudNativePG, SeaweedFS); no content in a third party's database.
* Buy, don't build: no CMS of our own, no app we have to build to get one.
* The website's rules hold: design-system components only, CSP `script-src
  'self'`, WCAG 2.2 AA, sitemap, RSS, hreflang, structured data, an offline
  build that needs no CMS.
* Social publishing through a tool an agent can drive, with a person's approval
  before anything goes out.

## Considered Options

For the CMS:

1. **Directus 12, self-hosted.**
2. **Keep git**, with or without a git-backed editor (Keystatic, Decap).
3. **Strapi 5, self-hosted.**
4. **Payload 3, self-hosted.**
5. **Sanity** (hosted).

For reading the content on the website:

* **A. Server-rendered blog routes** that read the CMS on request, with an
  in-memory stale-while-revalidate copy and a publish webhook that refreshes it.
* **B. Build-time fetch** and a publish webhook that triggers a rebuild and deploy.

For publishing social posts:

* **i. Buffer** (API and remote MCP server), handed approved posts from the CMS.
* **ii. LinkedIn's Posts API directly**, from a Directus Flow or a job of ours.
* **iii. Hootsuite or Publer.**
* **iv. By hand** from the CMS.

## Decision Outcome

Chosen: **Directus 12 self-hosted (1)**, read by **server-rendered routes (A)**,
with social posts drafted and approved in Directus and handed to **Buffer (i)**,
because Directus is the only candidate that runs from the vendor's image with its
schema, roles, flows and settings as files we commit (the official `d6s` CLI),
ships its own MCP server with OAuth and a no-delete switch, and keeps content in
plain Postgres tables we own; and because reading on request is the only way the
team publishes without a deploy.

### The north star

An editor (or Claude or our agent, through Directus' MCP server, as that person)
writes a post in German. The English translation is drafted next to it. On
"send to review" every publisher is notified; the publisher opens the post in
the website's live preview, comments or publishes, or schedules it for a date.
On publish the website shows it within seconds, with its share card, in the
sitemap, the feed and `llms.txt`; LinkedIn drafts for both languages appear,
the publisher approves them, and Buffer posts them at their time with tracked
links whose visits PostHog attributes. The team composes posts from the design
system's blocks (text, figures, screenshots, quotes, galleries, calls to action),
picks a line drawing or uploads an image cover that the presets keep on brand,
and edits other parts of the site the same way (home sections, FAQ, team, pilot
offices). An Insights dashboard shows what waits, what is scheduled, what went out.

### What lands now, and what each slice serves

| Slice | What | Serves | State |
|---|---|---|---|
| 1 | Deployment as code (`deploy/pulumi/src/platform/cms*.ts`, `data/cms-pg.ts`, `config/cms.ts`): Directus 12.6.1 by digest in namespace `cms`, its own CloudNativePG cluster `cms-pg`, files in SeaweedFS bucket `cms-files` as S3 identity `cms`, `https://cms.<baseDomain>`, NetworkPolicies, a config Job per change of the sync files; Compose profile `cms` | the whole star | built, `index-cms.spec.ts`; **off** until `cmsEnabled` and `cmsLicenseKey` |
| 2 | Schema and configuration as code (`apps/cms/directus`, pulled with `d6s`): posts with translations, Many-to-Any body blocks (`block_markdown`, `block_figure`, `block_image`, `block_quote`, `block_cta`), drawing or image covers, SEO fields, former slugs, authors; content versioning; roles Editor, Publisher, Agent, Website, Social hand-off; three flows (refresh the website, ask for review, draft the LinkedIn posts); an Editorial dashboard; asset presets only; MCP on with OAuth and no deletes | review workflow, agents, covers, blocks | built, pushed into an empty 12.6.1 and diffed clean; the permissions untested against a licensed instance |
| 3 | Import of the MDX posts, keyed by slug, idempotent (`apps/cms/scripts/import-blog.mjs`) | the cutover | built, run twice against a local instance |
| 4 | The website reads the CMS on request, falls back to the MDX fixtures without one (`apps/website/src/lib/{posts,cms,post-model}.ts`, `PostBlocks.astro`, `[segment].astro`, `/sitemap-blog.xml`, `/api/cms/revalidate`) | publishing without a deploy | built; build, a11y, routes and structured data pass in both modes |
| 5 | Social: model, UTM convention, Buffer hand-off with a dry run, drafts from the weekly release summaries (`apps/cms/social`) | LinkedIn | built and tested offline; not running: no Buffer account yet |
| 6 | Live preview and the Visual Editor for drafts; the website's preview route behind a token, `frame-ancestors` for the CMS host on it only | review | next |
| 7 | Directus' AI translation or our agent drafting the second language on create (a flow) | translation | next; AI translations are an Enterprise entitlement, the agent route is not |
| 8 | Site pages beyond the blog in the CMS, by the same block builder: home sections, FAQ, team, pilot offices. Not the legal pages (their review is a pull request, on purpose) and not the changelog (generated from release notes, ADR-0154) | team edits the site | later; each page type is collections, and the core tier's 25 is reached quickly |
| 9 | Galleries (a block with a files junction), redirects managed in the CMS beyond former slugs, more than one Directus replica (needs a shared cache and synchronization store) | blocks, scale | later |

### How the website reads it (option A)

The blog's routes (`/blog/`, `/blog/<segment>/`, the English twins, both feeds,
`/sitemap-blog.xml`, `/llms.txt`) are rendered on request by the existing Node
server. One `[segment]` route per locale answers both category pages and posts,
because two dynamic routes at one level cannot both render on request. With
`CMS_URL` and `CMS_TOKEN` the posts come from Directus: one request for every
live post, filtered to `published` and `publish_date <= $NOW` in the query as
well as by the token's policy, kept in memory for 60 s and served stale while
one request refreshes it, and the last good copy is kept when Directus is
down. The `Refresh the website` flow posts to `/api/cms/revalidate` on publish.
Each web pod keeps its own copy, so a publish is visible at once on the pod the
flow reached and within 60 s on the others. Pages carry `Cache-Control: public,
max-age=60, stale-while-revalidate=600`. A post published with a future date
appears when the date passes, with no job.

Without `CMS_URL` the same routes serve the MDX files in
`src/content/blog`, now fixtures: a local build, CI and every check run without a
CMS, and the checks that read the build (`check:structured-data`,
`check:a11y`) fetch the blog's pages from the production server through
`/sitemap-blog.xml`. `@astrojs/sitemap` lists only prerendered pages, so the blog
has its own sitemap, named in `robots.txt`.

Markdown is rendered by micromark with raw HTML escaped. Figures, images, quotes
and calls to action are the design system's components. Image covers and images
in a post come from Directus' asset presets (`cover`, `cover-small`, `share`,
`inline`, `inline-small`; `storage_asset_transform: presets`, so no other
transform is served), and the CMS's public origin is added to `img-src` and
nothing else.

**Covers.** A post's cover is a line drawing by id (the default: the drawings
stay code-reviewed SVGs in `apps/website/src/assets/covers`, framed by
`covers.ts`, and the CMS's choices are held to that folder by a test) or an
uploaded image with alt text, focal point and an AI flag, cropped by the presets
to the card's 3:2 and the share card's 1200 x 630. An SVG uploaded in the CMS is
not a cover type: the page inlines covers, an SVG can carry script, and the
drawing rules (`packages/brand/docs/blog-covers.md`) are checked by code no CMS
runs.

### Social posts

`social_posts` hold one post for one account (`social_accounts`, LinkedIn page
first) in one language: the text (3000 characters, LinkedIn's limit), the blog
post or link it carries, a UTM campaign, an optional image, a time. A post
without a blog post is allowed (company news; drafts from
`releasenotes/summaries.yaml`). Status: `draft`, `in_review`, `approved` (a
person, by permission), `scheduled` (handed over), `published`, `failed`,
`archived`. Nothing is posted without a person's approval: the drafting policy
cannot set `approved`, and the hand-off reads only approved posts.

**Publishing through Buffer.** `apps/cms/social/handoff.mjs` turns each approved
post into Buffer's `createPost` (the text with the tracked link, the blog post's
share image, `customScheduled` at its time or the account's queue) and records
Buffer's id or error. Buffer holds the LinkedIn connection, its tokens and its
app review. The hand-off is a dry run until a Buffer API key is set; reading
back `published` and the post's URL is the next step of this slice.

**Share card.** LinkedIn's Posts API does not scrape a link for its preview
(Posts API docs, "Article Post Creation", read 2026-11-05): the image is
uploaded. Every post has a raster share image already: a drawing's band rendered
to `/media/covers/<id>.png` (1200 x 630, sharp), or an image cover's `share`
preset (1200 x 630 JPEG). LinkedIn asks for 1.91:1; 1200 x 630 is that within a
pixel.

**UTM convention** (`apps/cms/social/links.mjs`), lower case and hyphens, which
PostHog's `$pageview` records as `utm_*` properties without any code of ours:
`utm_source` the network (`linkedin`), `utm_medium=social` (organic; paid would
be `paid-social`), `utm_campaign` the blog post's slug or the post's own
(`changelog-2026-w44`), `utm_content` the account and the post's id
(`linkedin-company-1a2b3c4d`), so two wordings of one article can be compared.

### Consequences

* Good, because a publisher publishes, unpublishes and schedules without
  engineering, and the website shows it within a minute.
* Good, because the twins of a post are one item: the language switch and
  hreflang can no longer point at a slug nobody checked.
* Good, because agents work through Directus' own MCP server as the person they
  act for, cannot delete, and cannot publish; every edit is a revision.
* Good, because schema, roles, flows, dashboard and settings are reviewed in pull
  requests and applied by the deploy, and a test holds the review rules.
* Good, because the content is in plain Postgres tables in our cluster.
* Bad, because the review step needs a license. Directus 12 is under the
  Monospace Sustainable Core License; without a key it runs the core tier, which
  refuses every permission with a rule (verified on 12.6.1: `RESOURCE_RESTRICTED
  custom_permission_rules_enabled`), limits Studio seats to 3, collections to 25,
  flows to 5, and keeps 30 days of revisions (`@directus/license` 0.6.1's
  `DIRECTUS_CORE_LICENSE`). The Open Innovation Grant is free under 5 M USD
  revenue and 50 employees, for a year at a time, five activations per key,
  bound to the public URL. The deployment deploys nothing without the key.
* Bad, because it is a new stateful service to run: a Postgres cluster, its
  backups (off until `cmsPgBackupsEnabled`), upgrades in step with the sync
  files (`d6s` pushes only between instances of one version).
* Bad, because the blog's pages are now rendered on request: the web pods do
  work per request (bounded by the 60 s copy), and a CMS outage on a cold pod
  is a 500 on the blog until it answers.
* Bad, because blocks of a published post's body are separate items: the
  drafting policy can update a block item directly through the API, bypassing
  review (the junction row is guarded, the block item is not: Many-to-Any has no
  field to filter a block by its post). The Studio edits a published post in a
  draft version; an API client could still change a live block. Close it with a
  filter on each block's `user_created` or a blocking flow before agents get the
  Agent role on production.
* Bad, because the permissions file is written by hand: a local instance
  without a license cannot hold the rules to pull them from.
* Neutral: Buffer is a third party that sees our social posts (public anyway),
  not our blog drafts.

### Confirmation

* `apps/cms/scripts/sync-files.test.mjs` (in `task website:verify`): the
  CMS's cover and category choices equal the website's, only the Publisher role
  holds the publishing policy, drafting can set no status beyond `in_review`,
  the public and the website read only what is live, MCP cannot delete, images
  transform only through presets.
* `apps/cms/scripts/import-blog.test.mjs`: every MDX post converts, twins pair
  and agree, no MDX survives in a body.
* `apps/website/src/lib/cms.test.ts`: the query asks for live posts only and
  reads every block field the CMS's schema files define; raw HTML is escaped.
* `deploy/pulumi/index-cms.spec.ts`: listener, route, image pin, secrets out
  of the pod spec, network policies, the S3 identity's single bucket, the
  config Job; nothing deployed without the license.
* `check:structured-data` and `check:a11y` read the blog's pages from the
  server.
* Not enforced yet: the permissions against a licensed instance (the first
  push on staging is the check), and the block-item gap above.

## Pros and Cons of the Options

### Directus 12, self-hosted

* Good, because the official `d6s` CLI (Environment Sync, Directus 12.3+) pulls
  and pushes schema and configuration (roles, policies, permissions, flows,
  dashboards, settings) as deterministic JSON. Done on 2026-11-05: pulled from
  one 12.6.1, pushed into an empty one, diff clean.
* Good, because its MCP server is built in (12.6.1: `mcp_enabled`,
  `mcp_allow_deletes`, OAuth with CIMD and DCR), with a system prompt we set.
* Good, because it runs from the vendor's image; we write no CMS code.
* Bad, because the license (above).

### Keep git (with Keystatic or Decap)

* Good, because nothing new runs, and review is a pull request.
* Bad, because every publish is still a build and a deploy (the problem), and a
  git-backed editor writes a commit per save as a bot.
* Premise of the rejection: the site's content is built into the image. If the
  site served content from git at runtime, re-check.

### Strapi 5

* Bad, because Strapi is a Node project we would build into our own image and
  upgrade with code migrations, and content types are files but roles and
  permissions are not (community plugins sync them).
* Bad, because review workflows and content history are paid tiers.
* Premise: Strapi's pricing and feature pages as remembered, not re-read on
  2026-11-05. Re-check before relying on it.

### Payload 3

* Good, because its config is TypeScript in the repo and drafts and versions are
  free.
* Bad, because Payload is a library embedded in a Next.js app we would build,
  run and patch: a second web app of ours.
* Premise: Payload ships no runnable server image. If it does, re-check; it is
  the strongest alternative.

### Sanity

* Bad, because content lives in Sanity's cloud, and the owner chose self-hosting
  in the EU.
* Premise: that choice. If it changes, Sanity's MCP server and GROQ make it a
  candidate.

### B. Build-time fetch and a rebuild per publish

* Bad, because a publish waits for CI and a deploy (minutes) and ties content to
  the release train, which is what the owner wants to end.
* Premise: the website's image is built in CI. A CDN with on-demand revalidation
  would change this.

### ii. LinkedIn's Posts API directly

* Bad, because posting as a company page needs the Community Management API:
  a vetted product for registered legal entities with a verified business
  e-mail, the page's super admin verifying the app, a Development tier
  (500 calls per app per day) and, for Standard, a screencast review; an app with
  that product may carry no other product; `w_organization_social` needs the
  member to be an ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER or
  CONTENT_ADMIN of the page (Microsoft Learn, "Community Management App
  Review", updated 2026-02-11; "Posts API", updated 2026-05-13; "Community
  Management Overview", updated 2026-05-15). Then an OAuth flow, token refresh,
  the Images API upload and versioned headers (`Linkedin-Version: YYYYMM`; 202511
  sunsets 2026-11-16) are code we own.
* Premise: Buffer stays available on the plan we use, with LinkedIn pages. If
  Buffer drops either, this is the fallback, and the CMS model does not change.

### iii. Hootsuite or Publer

* Not evaluated in depth: Buffer's API and MCP are on every plan including Free
  (Buffer, 2026-05-27). Re-check if Buffer's terms change.

### iv. By hand

* Good, because it needs nothing: an approved post is copied into LinkedIn's
  own scheduler. It is the state until the Buffer key exists.

## More Information

### AI-native check: Directus (2026-11-05)

| # | Criterion | Result | Evidence (source, date) |
|---|---|---|---|
| 1 | Official agent surface | yes: built-in MCP server at `/mcp` (tools `items`, `files`, `schema`, `flows`, …), OAuth for agents, REST and GraphQL with an OpenAPI spec | directus.com/docs/guides/ai/mcp, 2026-11-05; local 12.6.1 `tools/list`, 2026-11-05 |
| 2 | Scoped credentials | yes with a license: policies per role, static tokens per user, API-only users without a seat; the core tier refuses rules | local 12.6.1, 2026-11-05 (`RESOURCE_RESTRICTED`) |
| 3 | Schema and configuration as code | yes: `apps/cms/directus`, applied by `d6s sync push` in the deploy's config Job | `@directus/cli` 12.5.0; pull, push into an empty instance, clean diff, 2026-11-05 |
| 4 | Audit and rollback of agent edits | yes: drafts by status and permission, content versioning, a revision per edit, revert by revision; 30 days on the core tier, the plan's window with a license (Grant: "no feature limits", retention not stated) | local round trip below |
| 5 | Events | partly: Flows on every create, update, delete (three in `apps/cms`); a request carries a bearer, not a signature | local flows, 2026-11-05 |
| 6 | CLI | yes: `d6s`, and `directus` in the image | |
| 7 | Exit | yes: one Postgres table per collection, files in our bucket, the schema in git | |

Round trip done by: Claude Code (this change), 2026-11-05, on a local Directus
12.6.1: created a social post draft through the MCP `items` tool, edited it
through MCP, reverted it to its first revision (`POST /utils/revert/<id>`); an
MCP delete was refused ("Delete actions are disabled"). Agent surfaces in use:
the MCP server for Claude Code and our agent; REST for the website and the
scripts. Exceptions: line 2 needs the license key; until it exists the CMS is
not deployed.

### AI-native check: Buffer (2026-11-05)

| # | Criterion | Result | Evidence (source, date) |
|---|---|---|---|
| 1 | Official agent surface | yes: remote MCP `https://mcp.buffer.com/mcp` (OAuth) and a GraphQL API | developers.buffer.com/guides/integrations/mcp.html and buffer.com/resources/buffer-api-is-here (2026-05-27), read 2026-11-05 |
| 2 | Scoped credentials | partly: an API key per account, revocable; no read-only or draft-only key found | buffer.com/mcp, 2026-11-05 |
| 3 | Schema and configuration as code | n/a: we keep no configuration there beyond the connected channel; its id is a field of `social_accounts` | |
| 4 | Audit and rollback | partly: `saveToDraft`; the approval is ours, in Directus; `create_post` can publish at once, so agents get no Buffer write access | Buffer MCP guide, 2026-11-05 |
| 5 | Events | not found | |
| 6 | CLI | yes, released with the API | 2026-05-27 post |
| 7 | Exit | yes: we hold every post in Directus; Buffer only schedules | |

Round trip: not done (no account). Exceptions: lines 2 and 4, accepted because
Buffer receives only approved, public text and agents do not use its MCP.

### What the owner has to obtain

1. A Directus license key: apply for the Open Innovation Grant (directus.com,
   "Open Innovation Grant"), then set it as the stack secret `cmsLicenseKey`.
   One key covers staging and prod (five activations, bound to each `PUBLIC_URL`).
2. The CMS host: `cms.<baseDomain>` by default (`cmsDomain`); DNS follows the
   listener when `dnsEnabled`.
3. An off-cluster bucket for `cms-pg`'s PITR archive (`cmsPgBackup*`) before
   the first post is written there.
4. Buffer: an account (Free has 3 channels), the LinkedIn company page connected
   by a page admin, the channel id into `social_accounts.publisher_channel_id`,
   an API key as a secret, and where the hand-off runs (a CronJob next to the
   CMS, or a Flow). No LinkedIn app or review is needed on this route.
5. Only if Buffer is dropped: a LinkedIn developer app on the company page, the
   Community Management API's Development tier (legal entity, business e-mail,
   page super admin verification), a page admin's OAuth consent, and the
   Standard tier's screencast review for more than 500 calls a day.
6. SSO for editors: Directus' OpenID login against WorkOS is a Grant/paid
   feature; until then editors are Directus users with two-factor enforced by
   policy.

### Revisit when

* The core tier is all we have (no Grant): the review step then needs a
  blocking Flow instead of permissions, or another CMS.
* A Directus upgrade changes the `d6s` file format or the MCP server's tools.
* Publishing needs to reach every web pod at once (more pods, a CDN): move the
  copy to Dragonfly or Astro's route cache with a shared provider.
* Buffer drops LinkedIn pages or the API from our plan.

Sources, read 2026-11-05: directus.com/docs/guides/environment-sync (and its
quickstart and reference), directus.com/docs/guides/ai/mcp,
directus.com/docs/licensing/overview, directus.com/pricing,
github.com/directus/directus/releases (12.2.0 to 12.6.1),
community.directus.com "Everything v12" (2026-05-11),
learn.microsoft.com/linkedin (Posts API, Community Management overview and app
review), developers.buffer.com (MCP guide, create post examples),
buffer.com/resources/buffer-api-is-here (2026-05-27), docs.astro.build (content
collections, live collections).

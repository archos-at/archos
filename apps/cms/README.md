# The website's CMS

Directus, self-hosted ([ADR-0155](../../docs/adr/0155-the-website-blog-is-edited-in-a-self-hosted-directus.md)):
where the team writes, reviews and publishes the website's blog posts and drafts
their LinkedIn posts. The website reads published posts from it on request
(`apps/website/src/lib/cms.ts`), so publishing needs no build and no deploy.

This directory holds no Directus code. It holds what we configure Directus with,
as files an agent changes by pull request:

| Path | What it is |
|---|---|
| `directus/default/schema/` | The data model: one JSON file per collection, written by `d6s sync pull` |
| `directus/default/data/` | Roles, policies, permissions, flows, the Insights dashboard, folders, settings (MCP, asset presets) |
| `directus.config.json` | The `d6s` profiles; tokens never go here |
| `scripts/provision.mjs` | What sync files cannot hold: the two locales, the LinkedIn account, the robot users and their tokens |
| `scripts/import-blog.mjs` | Imports the MDX posts of `apps/website/src/content/blog` into a CMS, keyed by slug |
| `social/` | The UTM convention, the hand-off of approved social posts to Buffer, drafts from the weekly release summaries |

## The model

- **`blog_posts`**: status (`draft`, `in_review`, `published`, `archived`), publish date
  (a published post with a future date goes live then), category (`product`, `practice`,
  `technology`, as `apps/website/src/lib/categories.ts`), cover (a line drawing by id, or an
  uploaded image with alt text, focal point and an AI flag), author. Content versioning is
  on: a published post is edited in a draft version and promoted by a publisher.
- **`blog_posts_translations`**: per language its slug, title, description, SEO title and
  description, `noindex`, former slugs (each answers 301), and the body: **blocks** in order
  (`block_markdown`, `block_figure`, `block_image`, `block_quote`, `block_cta`), each drawn by
  a component of the design system (`apps/website/src/components/PostBlocks.astro`).
- **`social_posts`**: one post for one account in one language: text (3000 characters at
  most), the blog post it promotes or a link, UTM campaign, optional image, schedule, and
  what the hand-off recorded (Buffer's id, the URL, an error). Status `draft`, `in_review`,
  `approved`, `scheduled`, `published`, `failed`, `archived`.
- **`social_accounts`**, **`blog_authors`**, **`languages`**.

## Who may do what

| Role | Policies | May |
|---|---|---|
| Editor | Studio access, Content drafting | Write and edit drafts, send them to review; cannot publish, approve or delete what is live |
| Publisher | Studio access, Content drafting, Content publishing | Everything an editor may, plus publish blog posts and approve social posts |
| Agent | Content drafting | What an editor may, through the API or the MCP server, without a Studio seat |
| Website | Website reader | Read what is live (the website's token) |
| Social hand-off | Social hand-off | Move approved social posts on to `scheduled`, `failed` |

`scripts/sync-files.test.mjs` holds the parts that matter: only the Publisher role holds
the publishing policy, drafting can set no status beyond `in_review`, the website and the
public read only what is live, the MCP server cannot delete.

**The permissions need a license.** Directus 12 without a license key runs its core tier
(3 Studio seats, 25 collections, 5 flows, no SSO, 30 days of revisions) and refuses every
permission with a filter or a field list, which is what the roles above are made of. The
deployment therefore deploys nothing without `cmsLicenseKey`. Locally, without
`CMS_LICENSE_KEY` in `deploy/.env`, everything but those permissions works: `task cms:sync:push`
stops at the first permission, so empty the `records` of
`directus/default/data/directus-permissions_*.json` for that push (and restore the file
after), and work as the admin.

## Agents

The MCP server is on (`/mcp` on the CMS host), signs an agent in through OAuth as the
person it works for, so it has exactly their rights, and cannot delete. A system prompt
(settings) gives it the house rules. Claude Code: `claude mcp add --transport http cms https://cms.<baseDomain>/mcp`.
A robot agent gets a user with the Agent role and a static token.

## Locally

```bash
task cms:up            # Directus 12.6.1 and its Postgres (deploy/compose, profile `cms`)
task cms:sync:push     # the committed schema and configuration (with CMS_LICENSE_KEY in deploy/.env; see above)
task cms:provision     # locales, LinkedIn account, robots (website token: local-website-token)
task cms:import -- --apply   # the MDX posts
cd apps/website && CMS_URL=http://localhost:8055 CMS_TOKEN=local-admin-token bun run dev
```

Studio: http://localhost:8055, `admin@example.com` / `local-admin-password`.

## Changing the model or the configuration

1. Change it in the local Studio (or edit the JSON).
2. `task cms:sync:pull` writes the schema and configuration into `directus/` (roles and
   policies are left out: an unlicensed local instance would empty the permissions; edit
   those files by hand or pull them from a licensed instance).
3. `task cms:test`, then a pull request. The deploy's `cms-config-<hash>` Job pushes the
   files (`d6s sync push`, merge mode) and runs `provision.mjs`.

Merge mode never deletes. Removing a field, a collection or a policy is a person's
`npx d6s sync push --to <profile> --mode mirror --dangerously-allow-delete`, after a
`d6s sync diff`, because a delete in the CMS can take content with it.

**Upgrade.** `d6s` pushes only between instances of the same Directus version. Move
`CMS_IMAGE` (`deploy/pulumi/src/config/cms.ts`) and the Compose pin together, start the new
version locally, push, pull, commit what changed.

## Social posts

The `Draft the LinkedIn posts` flow drafts one post per language when a blog post is
published. A person edits and approves it; `social/handoff.mjs` (dry run by default)
hands every approved post to Buffer, with the link tracked by the UTM convention in
`social/links.mjs` and the blog post's share image. `social/release-summaries.mjs` drafts
posts from a week of `releasenotes/summaries.yaml`.

Not running anywhere yet: the hand-off needs a Buffer account with the LinkedIn page
connected, its API key, and a schedule (ADR-0155, "Open").

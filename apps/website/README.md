# website

The public website of the company, built with Astro as a static site. It replaced the previous
site (slice 5 of [the corporate design plan](../../docs/design/corporate-design-plan.md)): the `web`
image builds this directory (`ci/image_inputs.py`). The old site was deleted on 2026-10-29;
it is in git history.

Every visual value comes from the shared design system in `packages/brand`. The brand strings come
from `src/lib/identity.ts`, which reads `identity.json`.

## Run

```bash
bun install        # first, and after a pull that moves bun.lock
bun run dev        # http://localhost:4321
bun run build      # static output in dist/
bun run build && node runtime/server.mjs     # serve it as production does: headers, /healthz, 404
bun run check      # astro check, the brand copies (sync --check), then the brand rules (scripts/check_brand_rules.mjs)
bun run test       # runtime specs (node --test) and src/**/*.test.ts (bun test)
bun run check:a11y # after a build: axe-core WCAG 2.2 AA on every page, DE and EN (needs Playwright's Chromium)
bun run check:routes           # after a build: every old address answers its route fate (301 in one hop, or 410)
bun run check:structured-data  # after a build: every JSON-LD block parses and carries its type's required fields
```

Canonical URLs, the sitemap, hreflang, feeds and JSON-LD use the address the site is served from,
not the brand's domain: `PUBLIC_SITE_URL` (CI passes the prod stack's `baseDomain`), else that key
read from `deploy/pulumi/Pulumi.prod.yaml`, else `identity.json` (`src/lib/site-url.mjs`;
[domain cutover](../../docs/deployment/domain-cutover.md)).

Or from the repo root: `task website:install`, `task website:check`, `task website:build`, and
`task website:verify` for everything CI runs.

## Production server

`runtime/server.mjs` wraps the Astro node adapter's handler:

- **Security headers** on every response (`runtime/security-headers.mjs`): a Content-Security-Policy
  with `script-src 'self'` (plus PostHog's two EU origins when analytics is on) and no inline script
  at all, which `vite.build.assetsInlineLimit: 0` in `astro.config.mjs` makes true; `frame-ancestors
  'none'`, HSTS (no `includeSubDomains`: that is the domain owner's call), `nosniff`, Referrer-Policy,
  COOP and a Permissions-Policy. JSON-LD is data and needs no allowance.
- **`/healthz`** answers `ok` from the process itself; the Dockerfile's healthcheck uses it.
  The Kubernetes readiness and liveness probes in `deploy/pulumi` (`src/app/web.ts`) use it too.
- **Cache-Control** for static files (`runtime/cache-control.mjs`).

Unknown addresses get `src/pages/404.astro`, rendered on request so `/en/...` answers in English,
with status 404 and `noindex`. A page rendered on request that throws (the 404 page itself, `/sign-in`,
`/web-analytics.js`) gets `src/pages/500.astro` the same way, with status 500: Astro renders it
for the failing address, so its "reload" asks for that address again, and logs the error, which the
page never shows. The 404, 410 and 500 pages share `StatusBlock` and `StatusDrawing` (the
drawing's motion: `packages/brand/css/status.css`). Old public addresses and their fates (301, or 410 Gone) are in
`redirects.mjs`; see [SEO](#seo). `runtime/gone.mjs` turns the 404 of a gone address into 410.

## Changelog

`/changelog/` and `/en/changelog/` render `src/data/changelog.json`, product data written by
`scripts/release_notes.py publish` from the reno notes and committed by the release-notes workflow on
every merge to `develop` (`docs/contributing/release-notes.md`). Never edit the JSON; write a note.
`src/lib/changelog.ts` reads it, `src/views/ChangelogView.astro` lays each week out as a `ui-rows`
row with its sections folded like the FAQ. Notes from before the rename keep the name they shipped
under, and the page says so.

## Analytics

PostHog EU, through the official SDK and its built-ins. `/web-analytics.js` (`runtime/web-analytics.mjs`)
loads `posthog-js` when the container has `PUBLIC_POSTHOG_HOST` and `PUBLIC_POSTHOG_PROJECT_TOKEN`, and
answers an empty script otherwise.

**Consent, quietly** (owner decision D24). Until the visitor chooses, PostHog counts cookieless
(`cookieless_mode: 'on_reject'`, `opt_out_capturing_by_default: true`): nothing is stored on the device.
`src/components/ConsentNote.astro` shows a small note in the corner with two equal choices; "Accept"
calls `posthog.opt_in_capturing()` (the SDK then keeps `ph_<token>_posthog` as cookie and in
localStorage, and session replay may run with every input and text masked), "Decline" calls
`posthog.opt_out_capturing()` (stays cookieless). The SDK stores the choice in localStorage
(`__ph_opt_in_out_<token>`); the footer's "Cookie-Einstellungen" reopens the note. Without analytics
configured the note and the footer link never appear.

**The PostHog project must have cookieless server hash mode set to "stateful"**
(Settings, Project, Web analytics), or PostHog discards every cookieless event. On 2026-10-29 it was
off (`cookieless_server_hash_mode: 0`); the owner switches it.

What is measured, all by the SDK unless named:

| Signal | Source |
|---|---|
| Page views, page leaves with scroll depth (`$prev_pageview_max_scroll_percentage`), referrer, UTM parameters | `$pageview`, `$pageleave`, automatic |
| Web vitals (LCP, INP, CLS, FCP) | `capture_performance.web_vitals` |
| Clicks on links and buttons, form submits and changes, rage and dead clicks | autocapture |
| Where a call to action sits | `data-ph-capture-attribute-cta-area` and `-cta-label` on `Button`, `TextLink`, `CTABand` (areas: `header`, `mobile_menu`, `founders`, `security_cta`, `contact_info`, `not_found`, `server_error`; labels: `demo`, `login`, `open_app`, `contact`, `home`, `blog`, `retry`) |
| Language switch | `data-ph-capture-attribute-language-switch` (`de-en`, `en-de`) on the header link |
| Which form | `data-ph-capture-attribute-form` (`contact`, `demo`) on the form |
| `form_submitted` `{ form, method: 'mailto', locale, newsletter? }` | `MailForm.astro`, the one thing autocapture cannot see: the mail hand-off. No field values |
| `video_played` `{ video, locale }` | `Video.astro`, first play |
| Heatmaps | `enable_heatmaps` |

No event carries what a visitor typed. Dashboards: PostHog's Web Analytics product is the dashboard
(no dashboard as code). The demo funnel to build there: `$pageview` on `/demo/` (or `/en/demo/`), then
`$autocapture` change with `form = demo`, then `form_submitted` with `form = demo`.

## Forms

Contact and demo hand off to the visitor's mail program (owner decision D9): `MailForm.astro` builds a
`mailto:` with a subject and a readable `Label: value` body (`src/lib/mailto.ts`), opens it, and shows
what happens next and the address to write to if no mail program opened. Without JavaScript the
browser's own `mailto:` post is the fallback. Nothing reaches a server of ours, so nothing is stored.

Roadmap: the target is Attio. A form posts to an endpoint that creates the person and the request in
Attio, so a lead is recorded and answered from the CRM. Attio has a REST API and an MCP server, so an
agent can read and act on the same records (AI-native tooling).

## Accessibility

`bun run check:a11y` (`scripts/check-accessibility.mjs`) serves `dist/` and runs axe-core with the
WCAG 2.0, 2.1 and 2.2 A/AA rules on every page in the sitemap plus the unlisted pages and the 404 page, at 1280 and 390 px,
with the mobile menu open and a form in its sent state. Text on a photo, which axe can only flag for
review, is measured against every pixel behind it. It fails on any finding, and `task website:verify`
runs it.

## Layout

| Path | What it is |
|---|---|
| `src/layouts/BaseLayout.astro` | `<head>`, skip link, header, `<main>`, footer. Every page uses it. |
| `src/components/` | One Astro component per design-system component, ported from `packages/brand/react`. |
| `src/lib/identity.ts` | Typed brand strings, read from `identity.json`; `withName` fills `{name}` in copy. |
| `src/i18n/` | Languages: the route table (`paths.ts`), the shell strings (`ui.ts`), navigation (`nav.ts`) and page copy (`pages/`). See [Languages](AGENTS.md#languages). |
| `src/views/` | Page markup, one view per page, rendered for both locales. |
| `src/styles/brand/` | Committed copy of the design system (tokens, components, fonts, identity). Generated, never edited. |
| `src/styles/site.css` | Page glue only: skip link, `[hidden]`, image sizing. Uses tokens. |
| `src/assets/media/` | Photos, product screenshots and the video the pages render, as full-resolution masters (table below); `src/lib/media.ts` exports them. |
| `public/media/` | Files that keep a fixed address: the pilot office logos, the funding logo, the share card (table below). |

## Styles and brand

The files in `src/styles/brand/` are copies. `node packages/brand/sync.mjs` writes them from the
package, and `node packages/brand/sync.mjs --check` (run by `bun run check`) fails when a copy has
drifted. Change a token or a brand string in `packages/brand`, then sync.

## Media

Reference media from the eight-page reference site, renamed in English by what each file shows.
The tables give the source file and where it appears.

**Rendered media** are in `src/assets/media/`, as full-resolution masters: 2560 px on the long
edge at most, never shrunk by hand, WebP at quality 92 (photos) or 95 (screenshots), in sRGB.
Views take them from `src/lib/media.ts` and render them with Astro's `<Image>`, which builds
variants from 320 px (photos) or 640 px (screenshots) up to the master's width, with a `srcset` and
`sizes`, so a phone loads the variant its layout needs (the hero at 390 px: 57 KB instead of 181 KB;
a gallery card stays 2560 px, because on a phone it shows its image 500 px high and 1250 px wide).
The video is imported with `?url`, so it is served from `/_astro/` like the images. The built files
have hashed names, so a replaced master reaches every visitor at once. Photos show in their own
colours and brightness: no CSS filter darkens or tints them. Where text sits on a photo, the design
system's scrim behind the text gives it contrast (`components.css`, "Duo photo scrim"), and
`scripts/check-accessibility.mjs` measures it. The masters marked "Drive" come from the team's
Google Drive image folder `Fotos-und-Grafiken` (the video: its video folder), named by the page and
section order there.

| File in `src/assets/media/` | Source | Where it is used |
|---|---|---|
| `product-plan-revision-changes.webp` | `b3c4660c81.webp`, the composer hint retouched to the current name (Inter Regular 15.6 px, the app's face when it was captured); 2560 × 1460 | Home and „Planstände vergleichen“, hero image (plan revision with sources) |
| `product-search-derivation.webp` | Drive `02_Startseite_Galerie-1_Eine-Frage.png` (4960 × 1984), 2560 × 1024 | Home, gallery slide 1, "Suchen" |
| `product-compare-clearance.webp` | Drive `03_Startseite_Galerie-2_Planstand-und-Anforderungen.png` (4960 × 1984), 2560 × 1024 | Home, gallery slide 2, "Vergleichen"; „Planstände vergleichen“, requirements |
| `product-model-check.webp` | Drive `04_Startseite_Galerie-3_Komplexe-Modelle.png` (4960 × 1984), 2560 × 1024 | Home, gallery slide 3, "Prüfen" (3D model check) |
| `product-floor-plan-query.webp` | Drive `07_Startseite_Gebaut-fuer-Planungsbueros.png` (4864 × 1620), 2560 × 853 | Home, "Gebaut für Architektur- & Planungsbüros." (floor plan with questions); „Baurecht durchsuchen“ and „KI für Architekturbüros“ (the escape-route question) |
| `planner-design-photo.webp` | Drive `05_Startseite_Planerinnen-entwerfen.png` (2576 × 1940), 2560 × 1928 | Home, duo card "Planer:innen entwerfen." (photo, white text on the scrim) |
| `ai-search-compare-photo.webp` | Drive `06_Startseite_KI-sucht-vergleicht-prueft.png`, 1104 × 1424 (the original's size) | Home, duo card "KI sucht, vergleicht und prüft." (dark card, photo) |
| `knowledge-video.mp4` | Drive `archos_wissen_final_C_2432.mp4` (video folder), unchanged (H.264, 2432 × 1216, 34 s; a provisional cut) | German home only (its frames carry German text; the English home has no visual there until an English cut exists), the video "Das Wissen Ihres Büros wird nutzbar." H.264 MP4 plays in every current browser, so there is no WebM twin |
| `knowledge-video-poster.webp` | The video's frame at 6 s ("Doch es liegt verstreut."), 2432 × 1216 | Same video, poster |
| `team-conversation-photo.webp` | Drive `08_Startseite_Zitat-Foto.png` (grayscale), 1080 × 1350 | Home, portrait beside the feld72 quote |
| `jonathan-uhlemann.webp` | Drive `Founder/Unknown.jpg` (702 × 700), cropped to 4:5, 560 × 700 | Home, founders row "Das Planungsbüro der Zukunft entsteht heute." (portrait, 4:5) |
| `matthias-bigl.webp` | the retired site's original portrait (git history, 1086 × 1448, colour), cropped to 4:5 and set in greyscale like the others, 560 × 700 | Home, founders row (portrait, 4:5) |
| `ferdinand-rubenbauer.webp` | the retired site's team graphic (git history, `team.png`, right card, duotone), cropped to 4:5 and set in greyscale, 380 × 475; the largest version that exists, a new photo is still welcome | Home, founders row (portrait, 4:5) |
| `demo-panel-background.webp` | Drive `11_Demo_Hintergrund.png` (too large for the Drive connector), as the owner exported it: 2000 × 1140 WebP, sRGB, unchanged | Demo, background of the form panel |

| File in `public/media/` | Reference file | Where it is used |
|---|---|---|
| `share-card.png` | none, drawn by `packages/brand/build-brand-assets.mjs` (the wordmark and tagline from identity, outlined in Switzer Semibold, on the warm white) | Every page, `og:image` and `twitter:card` (1200 × 630, social previews) |
| `pilot-office-gerner-gerner-plus.svg` | `f3402543bd.svg` | Pilot office logo row (home, demo) |
| `pilot-office-zz-architecture.svg` | `3a9b73f14d.svg` | Pilot office logo row (home, demo) |
| `pilot-office-feld72.svg` | `1310a1a557.svg` | Pilot office logo row (home, demo) |
| `pilot-office-bewe-emp.svg` | `9e162c17b0.svg` | Pilot office logo row (home, demo) |
| `funding-aws-gray.png` | `e8ea93f801.png` | Footer, funding note (Austria Wirtschaftsservice) |

The reference fonts (`.woff2`) are not here: the design system ships them in `src/styles/brand/fonts/`.

## Icons

The icon is typographic: the wordmark's first letter in Switzer Semibold, ink on the warm white
(`packages/brand/docs/brand-basis.md`, "App icon"). `public/favicon.svg` is a copy of
`packages/brand/mark.svg`, its title filled from identity; it inverts under a dark colour scheme.
`favicon.ico`, `apple-touch-icon.png`, `icons/icon-{192,512}.png`, `icons/icon-maskable-512.png` (the
inverted variant) and `media/share-card.png` are drawn and rendered by
`packages/brand/build-brand-assets.mjs`, which writes them here and into the app (sharp and fontkit
from this app's devDependencies); a rename or a new tagline is a re-run of it. `bun run check` runs
its `--check`. `src/pages/manifest.webmanifest.ts` names them, with the name from
identity and the colour from the tokens. Every page carries schema.org `Organization` and `WebSite`
JSON-LD (`src/lib/structured-data.ts`), all from identity.

## Not done here

- The changelog page comes with the cutover work.
- There is no login page. Login goes to `/sign-in`, which hands over to the app; `/login` and `/en/login` redirect there.
- The company's LinkedIn URL is not known yet (`src/lib/social.ts`, TODO(owner)); the footer, contact page, privacy row and JSON-LD show it once it is set.

## SEO

The plan, its search clusters and what is still open: [`docs/product/website-conversion-and-seo.md`](../../docs/product/website-conversion-and-seo.md).

**Route fates.** Every address of the old site has one fate in `redirects.mjs` (owner decision D7):
a 301 to the page that answers the same question today, in one hop to its final target, or 410
when nothing here does. The table is written as data: `PAGES` (old top-level pages), `SECTIONS`
(old sections and the fate of each detail slug), `RENAMED_POSTS`, `RETIRED_BLOG_CATEGORIES` and `GONE_PREFIXES`; the `/de/*`
and `/en/<German segment>/*` aliases of the old site are derived from them. Astro answers the 301s
(`redirects` in `astro.config.mjs`). `src/pages/404.astro` asks `fateOf()` for anything no page
claimed: an alias the table does not spell out still gets its 301, and a gone address gets the
not-found view in its own words ("Diese Seite gibt es nicht mehr."), whose 404 `runtime/gone.mjs`
turns into 410 (Astro can send neither 410 from `redirects` nor a status of its own from the
error route). To change a fate, edit the row; `src/lib/route-fates.test.ts` fails a target that is
not a page, a chain, or a live page redirected away, and `bun run check:routes` asks the built
server for every row. A target other work adds (the changelog) is listed in `PENDING_TARGETS`
until it exists. Old spellings are history, so the brand-name checks skip `redirects.mjs`; tests
and scripts check those rows through the table and never spell them.

**Adding a page to the sitemap and the structured data.** A page in `ROUTES` (`src/i18n/paths.ts`)
is in the sitemap with its other-locale twin as the `xhtml:link` pair (`sitemap.mjs`). For its
`lastmod`, add its view and copy file to `PAGE_SOURCES` in `sitemap.mjs` (the date of their last
commit; the image build has no git, so there the page carries no date). Posts pair through
`translationSlug` and are dated by `pubDate`. A route in `UNLISTED_ROUTES` (same file) is built and
answers, but is left out of the sitemap, the navigation and `llms.txt` and carries `noindex`
(`BaseLayout`); `src/lib/unlisted-routes.test.ts` fails a link to it, and `check:a11y` still visits
it. JSON-LD comes from `BaseLayout`: every page has
`Organization` and `WebSite`; every indexed inner page gets a `BreadcrumbList` (Start › title;
pass `crumbs` for the levels between); a page that renders `FAQ` passes the same items as `faq`
and gets an `FAQPage`; anything else goes in `graph` (`SoftwareApplication` on home, `BlogPosting`
on a post, built in `src/lib/structured-data.ts`). No `offers` or ratings: there is no public price
and there are no public reviews. `bun run check:structured-data` holds all of it.

**Feeds and llms.txt.** `/rss.xml` and `/en/rss.xml` (`src/lib/feed.ts`, `@astrojs/rss`) keep the
old feed addresses; blog pages link them in `<head>`. `/llms.txt` is generated from identity, the
listed product pages' own titles and descriptions and the newest posts (`src/pages/llms.txt.ts`, copy in
`src/i18n/pages/llms.ts`).

**Social previews.** A blog post shares its cover (`/media/covers/<id>.png`, see [Blog](#blog)):
a cover is that page's motif and has no text, so it needs no font. Every other page shares
`share-card.png` (the wordmark and the tagline, drawn by `packages/brand/build-brand-assets.mjs`),
with its own title and description. Generated cards for the other pages (`astro-og-canvas`, or
satori) were not adopted: each card needs a design pass (the plan asks for a motif per page) and
the brand fonts in a format the renderer reads (the design system ships WOFF2 only), which no
integration does simply. The plan's card spec stays in the SEO doc as an open item.

## Signed in

A visitor who is signed in to the app sees "App öffnen" / "Open app" in the header instead of "Login".
The app keeps a contentless `signed_in=1` cookie on the website's domain while it has a session
([authentication flow](../../docs/technical-reference/authentication-flow.md#the-websites-signed_in-cookie)).
`src/scripts/signed-in.js`, loaded blocking in `<head>` from `BaseLayout`, sets `data-signed-in` on
`<html>` when it finds it, and `site.css` shows the matching one of the two buttons `Header.astro`
renders (`.site-signed-out`, `.site-signed-in`), so the swap happens before paint. Without the cookie or
without JavaScript the header says "Login". Both buttons go to `/sign-in`, which hands over to the app's
`/?sign-in`: the app opens for a browser with a session and signs in any other. The cookie is in the
privacy policy (`src/i18n/pages/privacy.ts`, "Anmeldestatus").

## Blog

Posts are MDX in `src/content/blog/<locale>/<slug>.mdx` (schema in
`src/content.config.ts`), figures in `src/components/figures/`. A post's file name is its
slug; `translationSlug` names its twin in the other locale for the language switch and
hreflang. Drafts build only with `PUBLIC_INCLUDE_DRAFTS=1`.

Every post's frontmatter, checked by the schema:

| Field | Required | Holds |
|---|---|---|
| `title` | yes | The heading; a soft hyphen (`\u00AD` in a double-quoted string) marks where a long compound may break, and is stripped for `<title>`, JSON-LD and the feed |
| `description` | yes | The lead under the heading, the card text, the meta and feed description |
| `pubDate` | yes | `YYYY-MM-DD`; sorts the listing, dates the sitemap and JSON-LD |
| `draft` | no (`false`) | `true` keeps the post out of every build except `PUBLIC_INCLUDE_DRAFTS=1` |
| `category` | yes | `product`, `practice` or `technology` (below) |
| `cover` | yes | The id of the post's cover in `src/assets/covers/` (below), the same in both translations |
| `translationSlug` | no | The other locale's slug |

**Categories.** Three, defined once in `src/lib/categories.ts`: `product` (Produktfeatures /
Product features), `practice` (Praxiserfahrungen / From practice) and `technology`
(Technologie / Technology). The id is English and stored in the post's `category`; the URL
segment is the label in each language (`/blog/praxiserfahrungen/`, `/en/blog/from-practice/`),
so a category page names its twin for the language switch, hreflang and the sitemap. A post
slug may not equal a segment, because both live at `/blog/<x>/`. The first two categories,
Journal and Bautagebuch, redirect to Praxiserfahrungen and Technologie
(`RETIRED_BLOG_CATEGORIES` in `redirects.mjs`).

**Covers.** Every post names its `cover`, a line drawing in `src/assets/covers/<id>.svg`
shared only with its translation; the schema fails a post without one. `src/lib/covers.ts`
puts the drawing in the shared frame (ground, module grid, hatch), `PostCover.astro`
inlines it on the card (the whole 3:2 canvas) and under the post's lead (the 1200 × 630
band), styled by the brand's `covers.css`, and `src/pages/media/covers/[id].png.ts` renders
the band to `/media/covers/<id>.png` at build time with sharp, the post's `og:image` and
JSON-LD `image`. How to draw one: [`packages/brand/docs/blog-covers.md`](../../packages/brand/docs/blog-covers.md).

Screenshots of every route for a PR: `bun run capture` (see [visual screenshots](../../docs/ux/visual-screenshots.md#website-targets)).

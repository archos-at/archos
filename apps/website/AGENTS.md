# Website: contributor guide

This is the public website, built from the shared design system. Read the root
[`AGENTS.md`](../../AGENTS.md) too; this file adds what holds only here.

## Obligations

| When you | You must | Why |
|---|---|---|
| Need a style change | Change `packages/brand` (tokens or `css/components.css`), then run `node packages/brand/sync.mjs` | `src/styles/brand/` is a generated copy. A hand edit is overwritten by the next sync and fails `--check`. |
| Need a brand string (name, claim, address, e-mail, domain) | Read it from `src/lib/identity.ts`; in copy write `{name}` and pass it through `withName` | Brand strings are copy. A typed name breaks at the next rename. |
| Add a page or a string | Provide `de` and `en`. Page copy in `src/i18n/pages/<key>.ts`, markup in `src/views/<Page>View.astro`, two thin route files (`src/pages/<de-path>.astro` and `src/pages/en/<en-path>.astro`). A new route is one row in `src/i18n/paths.ts`. Shell strings go in `src/i18n/ui.ts`. | The English dictionary is typed `typeof de`, so a missing key fails `astro check`. Pages written only in German are the thing this rule ends. |
| Build a page or a block | Use only the components in `src/components/` and the tokens | The design system is the one source. A new visual needs a design-system change first. |
| Add a value (colour, size, spacing) | Use a token from `tokens.css`. Never a literal | Spacing comes from the `--space-*` scale; no new colours or sizes in `site.css`. |
| Write German copy | Follow the German copy rules in [`packages/brand/README.md`](../../packages/brand/README.md) | Sie-form, colon gendering, no exclamation marks, buttons start with a verb, no AI jargon. |
| Name a file, a component or a class | Follow [`naming.md`](../../docs/contributing/naming.md#casing-and-form): English, brand-free, `PascalCase.astro` components, kebab-case everything else | `ui-button`, `DuoCards`, never a product name. |
| Add an image | A photo or screenshot the page renders goes in `src/assets/media/` as the full-resolution master (3840 px long edge at most, never shrunk by hand, sRGB; at least as many pixels as its widest drawing needs, README "Media"), is exported from `src/lib/media.ts` and is rendered with Astro's `<Image>` and its `widths` and `sizes`. Only a file that must keep a fixed address (a logo, the share card) goes in `public/media/`. English kebab-case name, and a row in the table in `README.md`. No CSS filter on a photo: text on it gets its contrast from the design system's scrim | The table is how a reader finds out what a file shows. A phone must not download a 3840 px master, and a retina screen must not get a blurry one: a master narrower than its drawing in device pixels is enlarged and looks soft. A filter that darkens or tints a photo is what made the reference's photos dull and colour-shifted |
| Add an AI-generated image | Mark it with the `AITag` component | The design system requires the mark. |
| Write a blog post | Write it in the CMS (`apps/cms`, ADR-0155): both languages live in one post, and a person with the Publisher role publishes it. A new cover drawing is a pull request: `src/assets/covers/<id>.svg`, drawn by [`packages/brand/docs/blog-covers.md`](../../packages/brand/docs/blog-covers.md), and the same id in `COVER_DRAWINGS` (`apps/cms/src/fields/choices.ts`) | `apps/cms/tests/choices.test.ts` fails a CMS cover, category or call-to-action list that differs from this app's; `src/lib/covers.test.ts` fails a drawing outside the system |
| Change the MDX fixtures in `src/content/blog` | Keep them a faithful offline copy: give a fixture a `category`, a `cover`, and set `translationSlug` to its twin's slug | The content schema; `apps/cms/tests/import-blog.test.ts` fails twins that do not name each other or disagree, and MDX the CMS cannot hold |
| Render something new from the CMS | A block: its config in `apps/cms/src/blocks/`, its props in `BLOCK_PROPS` (`src/lib/post-blocks.ts`), its component in `src/components/PostBlock.astro` (`apps/cms/README.md`, "Adding a block"). A node of the rich text: `src/components/RichText.astro`. Never put CMS text into the page as raw HTML | `src/lib/rich-text.test.ts` fails a CMS block without props here or without a component in `PostBlock.astro` |
| Edit a legal page (`/datenschutz`, `/impressum`, the English twins) | Leave no bracketed placeholder (`[14 Tagen]`, `[EU]`); a value nobody verified is marked `TODO(owner):` and listed in the pull request | Nothing yet: `check_brand_rules.mjs` does not look for brackets |
| Write a component that scripts | Keep the script in the `.astro` file's `<script>` (Astro bundles it to `/_astro/`) and keep state in attributes. Never `is:inline` with a body, never an inline event handler | No React, no framework runtime. The Content-Security-Policy says `script-src 'self'` (`runtime/security-headers.mjs`): an inline script is blocked in production. |
| Add a call to action, a form or a link worth measuring | Pass `cta`/`ctaLabel` to `Button` or `TextLink` (or `area` to `CTABand`), `id` to `MailForm`; let PostHog's autocapture do the rest. A custom `posthog.capture` only for what autocapture cannot see, named in English snake_case and added to README "Analytics" | Buy, don't build: the SDK records clicks, page views, scroll depth, UTMs and web vitals itself. No event may carry what a visitor typed. |
| Put text on a photo | Add its selector to `PHOTO_TEXT` in `scripts/check-accessibility.mjs` | axe cannot measure text on images; that list is how the gate measures it (4.5:1 against every pixel). |
| Change what the page stores, sends or shows to PostHog | Change `src/i18n/pages/privacy.ts` in the same commit | The privacy policy states exactly what `runtime/web-analytics.mjs` configures. |
| Move, rename or remove a public address | Give the old address a fate in `redirects.mjs` (301 in one hop to the page that answers it now, or 410) and run `bun run build && bun run check:routes` | `src/lib/route-fates.test.ts` fails a target that is not a page or is itself redirected; nothing catches a forgotten old address but this row. README, "SEO" |
| Add a page | Its row in `ROUTES` puts it in the sitemap with its twin; add its view and copy file to `PAGE_SOURCES` in `sitemap.mjs` for its date; pass its FAQ items to `BaseLayout` as `faq` | `bun run check:structured-data` fails an FAQ without `FAQPage` and an inner page without breadcrumbs |
| Change a page | Run `bun run build && bun run check:a11y` | WCAG 2.2 AA is the bar (owner decision D21); the gate fails on any axe finding. |

## Layout

Every page renders through `src/layouts/BaseLayout.astro`, which provides the header, footer and
`<main>`. A page that needs no header (the split pages) passes `bare` to the same layout.
`src/i18n/nav.ts` builds the navigation and footer links for a locale; change the labels in `src/i18n/ui.ts`
and the paths in `src/i18n/paths.ts`, not in a page.

## Languages

German is the default and lives at the root; English is under `/en/` with English first segments (`/datensicherheit` is `/en/security`).
Astro's `i18n` config in `astro.config.mjs` sets the locales and `prefixDefaultLocale: false`. Everything else goes through two files:

- `src/i18n/paths.ts`: `ROUTES`, one row per page with its `de` and `en` path. `localePath(key, locale)` builds a link, `alternateOf(pathname)` gives the other locale's twin (language switch and hreflang), `localeFromUrl(url)` reads the locale of a URL.
- `src/i18n/ui.ts` and `src/i18n/pages/<key>.ts`: the strings. Each exports `{ de, en }` with `en` typed `typeof de`. Brand name as `{name}`, filled by `withName`.

A view takes a `locale` prop and renders the page once for both locales. The two route files only say which locale: `<HomeView locale="de" />` and `<HomeView locale="en" />`. `BaseLayout` requires `locale`, and so do the components that print a UI string (`Gallery`, `Video`, `AITag`, `DuoCards`, `SplitPage`).

Converting a German-only page: move its copy to `src/i18n/pages/<key>.ts` with an English translation, move its markup to `src/views/<Page>View.astro`, write the two route files, and add its row to `ROUTES` if its path is new. The home page is the worked example (`src/i18n/pages/home.ts`, `src/views/HomeView.astro`).
Until a page is converted its English twin does not exist, so the language switch and hreflang on a German page point at a 404.

To capture a visual change for a PR, run `bun run capture` ([instructions](../../docs/ux/visual-screenshots.md#website-targets)).

# Website: `apps/website`

The public website, an Astro site built from the shared design system.

Each rule in full, with its reason: [`README.md`](README.md#contributor-rules-in-full).

- Change a style in `packages/brand`, then `node packages/brand/sync.mjs`: `src/styles/brand/`
  is a generated copy, and `--check` fails a hand edit.
- Read a brand string from `src/lib/identity.ts`; in copy write `{name}` and pass it through `withName`.
- Every string exists in `de` and `en` (`src/i18n/`), `en` typed `typeof de`. `astro check`.
- Build from `src/components/` and tokens only; a new visual is a design-system change first.
- A rendered photo goes in `src/assets/media/` as the master and is drawn with `<Image>`,
  `widths` and `sizes`; add its row to the README "Media" table.
- Render CMS content through `PostBlock.astro` and `RichText.astro`, never as raw HTML.
  `src/lib/rich-text.test.ts`.
- Keep a component's script in its `.astro` `<script>`: the CSP blocks inline scripts.
- Text on a photo needs its selector in `PHOTO_TEXT` (`scripts/check-accessibility.mjs`).
- A change to what PostHog receives changes `src/i18n/pages/privacy.ts` in the same commit.
- A moved or removed address gets its fate in `redirects.mjs`. `bun run check:routes`.
- After changing a page, run `bun run build && bun run check:a11y`.

Before you add a page, read [Languages](README.md#languages) and [SEO](README.md#seo).

# AuthKit branding (WorkOS hosted sign-in)

The sign-in page is WorkOS's hosted AuthKit, so it is not rendered by the app and
no deploy changes it. Its look is a **manual step per WorkOS environment**: paste
the brand's stylesheet into the environment's branding. Staging has it;
**Production does not until someone does the steps below.** Nothing in this
repository writes to WorkOS for this (no `--apply`).

## Source

| What | Path |
|---|---|
| The stylesheet's source (literals of the brand tokens) | `packages/brand/authkit/authkit.css` |
| The photo it inlines | `packages/brand/authkit/login-photo.webp` |
| Renderer (inlines the photo, strips the header comment) | `packages/brand/authkit/build.mjs` |
| **The file to paste** | `packages/brand/dist/authkit.css` (written by the renderer, committed) |
| The photo, served for the hosted page | `apps/website/public/media/login-photo.webp`, at `https://<website>/media/login-photo.webp` |

### Two forms of the stylesheet

- **Hosted photo (preferred).** `LOGIN_PHOTO_URL=https://<website>/media/login-photo.webp node packages/brand/authkit/build.mjs`
  prints the stylesheet with the photo as a URL: about 8 KB, and the photo at full
  resolution and quality. AuthKit's page allows images from any origin
  (`img-src * data:`) and the website sends no `Cross-Origin-Resource-Policy`, so it
  loads. Use the website of the same environment: `dev.piloti.at` for Staging,
  `piloti.at` for Production, and only once that website's deploy serves the file.
  It is small enough to set through the WorkOS connector
  (`updateAppBranding`, `customCssElements.authkitGlobal`).
- **Inlined photo.** `dist/authkit.css`, the photo as a data URI (about 85 KB), for
  an environment whose website does not serve the photo yet.

## Steps (Production)

1. From the repository root, render the file and check it is current:
   `node packages/brand/authkit/build.mjs` (prints `dist/authkit.css: <n> bytes`).
   `git status` must show no change to `packages/brand/dist/authkit.css`; if it
   does, the committed copy was stale: commit it first.
2. Open the WorkOS dashboard, select the **Production** environment, then
   **Branding** (Authentication, AuthKit) and the **Custom CSS** field for the
   global stylesheet.
3. Replace its content with the whole of `packages/brand/dist/authkit.css`
   and save.
4. In the same Branding screen make sure the layout is **TwoColumn** with the
   content panel on the right and the custom HTML
   `<div class="panel-photo"></div>` (the stylesheet draws the photo into it).
5. Open the Production sign-in page in a private window at 1440 and 390 pixels
   wide, light and dark: the form column on the left and the photo on the right
   at 1440, one centred column at 390, black primary button, no coloured
   accents.
6. Record the date and who did it in the release note's `operators` section.

The same through the API instead of the dashboard: set
`customCssElements.authkitGlobal` of the environment's branding to the file's
content.

## What to know

- WorkOS puts the CSS in a low cascade layer, so the file overrides AuthKit's own
  rules with `!important`; do not strip it.
- AuthKit loads only Google Fonts, so the page's type falls back to the system
  sans. The wordmark and General Sans do not load there; this is a platform limit,
  not a missing step.
- `light-dark()` works inside it, `prefers-color-scheme` does not.
- The values in the file are the tokens' literals. After a token change,
  `node packages/brand/build-tokens.mjs`, update `authkit.css` by hand, rerun
  `build.mjs` and repeat the steps above in every environment.
- The product name AuthKit shows ("Sign in to ...") is the environment's
  application name in the dashboard, not this stylesheet.

# Mail: `packages/mail`

The shared way to send an email from a TypeScript app: an SMTP sender (Google Workspace by default,
login from `SMTP_USER` / `SMTP_PASSWORD`) and the brand's mail layout, HTML in the design system's look
with the dark footer, built from blocks (`paragraph`, `infoList`, `panel`, `button`, `note`).

No app's Docker build sees `packages/`, so `sync.mjs` copies `src/` into each app that opts in, as
`packages/brand/sync.mjs` does for the tokens. Edit `src/`, never a copy, then run
`node packages/mail/sync.mjs`; `--check` fails on drift and runs in the website's `bun run check`.

To opt an app in:

1. Add its directory to `TARGETS` in `sync.mjs` (the website's is `apps/website/src/lib/mail`) and run it.
2. Add `nodemailer` to the app's `package.json`, the version the website pins.
3. Add `node ../../packages/mail/sync.mjs --check` to the app's check script.
4. Pass `mailLook` the app's own copy of the brand's `tokens.css` and `mailPage` its `identity.json`.

The website's use, a form enquiry with a confirmation: `apps/website/src/lib/enquiry-delivery.ts`.

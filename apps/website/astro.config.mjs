import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import node from '@astrojs/node'
import sitemap from '@astrojs/sitemap'
import { redirects } from './redirects.mjs'
import { siteUrl } from './src/lib/site-url.mjs'
import { serializeSitemapItem, sitemapFilter } from './sitemap.mjs'

const identity = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src/styles/brand/identity.json', import.meta.url)), 'utf8'),
)

export default defineConfig({
  site: siteUrl({
    stackFile: fileURLToPath(new URL('../../deploy/pulumi/Pulumi.prod.yaml', import.meta.url)),
    brandDomain: identity.domain,
  }),
  i18n: {
    locales: ['de', 'en'],
    defaultLocale: 'de',
    routing: { prefixDefaultLocale: false },
  },
  adapter: node({ mode: 'standalone' }),
  redirects,
  integrations: [
    mdx(),
    sitemap({
      i18n: { defaultLocale: 'de', locales: { de: 'de', en: 'en' } },
      filter: sitemapFilter,
      serialize: serializeSitemapItem,
    }),
  ],
  vite: {
    build: { assetsInlineLimit: 0 },
  },
})

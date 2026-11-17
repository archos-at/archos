import type { MetadataRoute } from 'next'
import { PRODUCT_NAME } from '@/lib/brand'
import { THEME_COLOR } from './theme-boot'

const manifest = (): MetadataRoute.Manifest => ({
  name: PRODUCT_NAME,
  short_name: PRODUCT_NAME,
  description: 'Workspace for planning offices',
  start_url: '/',
  display: 'standalone',
  background_color: THEME_COLOR.light,
  theme_color: THEME_COLOR.light,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
})

export default manifest

import { type ReactNode } from 'react'
import { type Metadata, type Viewport } from 'next'
import localFont from 'next/font/local'
import { connection } from 'next/server'
import { ChunkReloadGuard } from './chunk-reload-guard'
import { STORAGE_RENAME_BOOT_SCRIPT } from './storage-rename-boot'
import { THEME_BOOT_SCRIPT, THEME_COLOR } from './theme-boot'
import { Providers } from './providers'
import { NavigationTrail } from '@/components/shell/navigation-trail'
import type { AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { isVlmConfigured } from '@/lib/documents/vlm-capability'
import { getEffectiveMaxUploadBytes } from '@/lib/storage/upload-limit'
import { getUserSession } from '@/lib/auth/session'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { PRODUCT_NAME } from '@/lib/brand'
import { FEATURE_FLAGS, isFeatureEnabled, type KnownFeatureFlag } from '@/lib/authz/feature-flags'
import { getLocale } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'
import './globals.css'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { postHogConfigFromEnv, type PostHogConfig, type PostHogIdentity } from '@/lib/analytics/posthog-config'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { configuredPublicSiteOrigin } from '@/lib/public-site'

const bodySans = localFont({
  src: '../shared/brand/fonts/GeneralSans-Variable.woff2',
  weight: '200 700',
  variable: '--font-body',
  display: 'swap',
})

const geistMono = localFont({
  src: '../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
}

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} — Workspace for planning offices`,
    template: `%s — ${PRODUCT_NAME}`,
  },
  description:
    'Workspace for planning offices: projects, files, the building model, tasks and research, with Office filing and building law at hand. Every answer cites its source.',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: PRODUCT_NAME, statusBarStyle: 'default' },
  applicationName: PRODUCT_NAME,
}

const isImageUploadEnabled = async (): Promise<boolean> =>
  isSessionFlagEnabled(FEATURE_FLAGS.imageUpload)

const isIfcUploadEnabled = async (): Promise<boolean> =>
  isSessionFlagEnabled(FEATURE_FLAGS.ifcModels)

const isSessionFlagEnabled = async (flag: KnownFeatureFlag): Promise<boolean> => {
  try {
    return await runWithTenantSlot(async () => {
      const session = await getUserSession()
      return isFeatureEnabled(session ?? { featureFlags: null }, flag)
    })
  } catch {
    return isFeatureEnabled({ featureFlags: null }, flag)
  }
}

const getSessionMaxUploadBytes = async (): Promise<number | undefined> => {
  try {
    return await runWithTenantSlot(async () => {
      const session = await getUserSession()
      if (!session?.organizationId) return undefined
      return getEffectiveMaxUploadBytes(session.organizationId)
    })
  } catch {
    return undefined
  }
}

const getPosthogIdentity = async (
  posthog: PostHogConfig,
  locale: string
): Promise<PostHogIdentity | null> => {
  if (!posthog.host || !posthog.projectToken || !isAuthRequired()) return null
  try {
    return await runWithTenantSlot(async () => {
      const session = await getUserSession()
      if (!session?.userId) return null
      return {
        distinctId: session.userId,
        organizationId: session.organizationId,
        organizationName: await getOrganizationDisplayName(session.organizationId),
        role: session.role,
        locale,
      }
    })
  } catch {
    return null
  }
}

const getAppConfig = async (locale: string): Promise<AppConfig> => {
  const [imageUploadEnabled, vlmAvailable, ifcUploadEnabled, maxFileSizeBytes] = await Promise.all([
    isImageUploadEnabled(),
    isVlmConfigured(),
    isIfcUploadEnabled(),
    getSessionMaxUploadBytes(),
  ])
  const posthog = postHogConfigFromEnv(process.env)
  return {
    authRequired: isAuthRequired(),
    fileUpload: getFileUploadConfigFromEnv(process.env, {
      imageUploadEnabled,
      vlmAvailable,
      ifcUploadEnabled,
      maxFileSizeBytes,
    }),
    posthog,
    posthogIdentity: await getPosthogIdentity(posthog, locale),
    publicSiteUrl: configuredPublicSiteOrigin(),
  }
}

interface RootLayoutProps {
  children: ReactNode
}

const RootLayout = async ({ children }: RootLayoutProps): Promise<ReactNode> => {
  await connection()
  const locale = await getLocale()
  const config = await getAppConfig(locale)
  const t = commonCopy.messages[locale]

  return (
    <html
      lang={locale}
      id="style-root"
      className={`${bodySans.variable} ${geistMono.variable} overscroll-none`}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: it sets `.dark` while <head> is parsed, so the
            first paint is already in the reader's theme (theme-boot.ts). The
            app sends no Content-Security-Policy for documents yet; the day it
            does, this script needs the request nonce like Next's own. The
            first moves browser keys off their old names (storage-rename-boot.ts),
            so the theme script and every store read the new ones. */}
        <script dangerouslySetInnerHTML={{ __html: STORAGE_RENAME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/* `overscroll-none` on html and body: inside the app the document never
          scrolls (the shell is one viewport tall and scrolls inside), so all a
          pull past the edge can do on iOS is rubber-band the whole app, chrome
          included, away from the keyboard and the composer. Pages that do
          scroll the document still scroll; they lose only the bounce and
          Android's pull-to-refresh. Inner scrollers keep their own setting. */}
      <body className="bg-surface-base text-foreground font-sans antialiased overscroll-none">
        <ChunkReloadGuard />
        <a
          href="#main-content"
          className="focus-visible:z-skip-link focus-visible:bg-primary focus-visible:text-primary-foreground sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:rounded-full focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-md"
        >
          {t.actions.skipToContent}
        </a>
        <Providers config={config} locale={locale}>
          {/* Records where the reader has been, so the pages outside the project
              shell can offer a back control that actually goes back. */}
          <NavigationTrail />
          {children}
        </Providers>
      </body>
    </html>
  )
}

export default RootLayout

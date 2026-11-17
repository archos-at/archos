'use client'

import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components'
import { MotionConfig } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppConfigProvider, type AppConfig, useAppConfig } from '@/shared/context'
import { useLayoutStore } from '@/features/layout'
import { useChatStore } from '@/features/chat/store'
import type { ThemeMode } from '@/features/layout'
import { I18nProvider, useLocale, type Locale } from '@/i18n'
import { THEME_COLOR } from './theme-boot'
import { fetchUserPreferences, patchUserPreferences } from '@/lib/user-preferences/client'
import { useAuth } from '@/adapters/auth'
import {
  DISABLED_POSTHOG_CONFIG,
  identifyPosthog,
  initPosthogClient,
  isPosthogEnabled,
  registerPosthogContext,
  resetPosthog,
} from '@/lib/analytics/posthog'

interface ProvidersProps {
  children: ReactNode
  config: AppConfig
  locale: Locale
}

const THEME_MODES: ReadonlySet<string> = new Set(['system', 'light', 'dark'])
const isThemeMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && THEME_MODES.has(value)

const PostHogIdentitySync = (): null => {
  const { authRequired, isAuthenticated, user, organizationId } = useAuth()
  const { posthog: posthogConfig = DISABLED_POSTHOG_CONFIG, posthogIdentity } = useAppConfig()
  const { locale } = useLocale()
  const previousDistinctId = useRef<string | null>(null)
  const distinctId = authRequired && isAuthenticated && user?.id ? user.id : null

  useEffect(() => {
    initPosthogClient(posthogConfig, posthogIdentity)
  }, [posthogConfig, posthogIdentity])

  useEffect(() => {
    if (!distinctId) {
      if (previousDistinctId.current && isPosthogEnabled()) resetPosthog()
      previousDistinctId.current = null
      return
    }
    if (!isPosthogEnabled() || previousDistinctId.current === distinctId) return

    if (previousDistinctId.current) resetPosthog()
    identifyPosthog(distinctId)
    previousDistinctId.current = distinctId
  }, [distinctId])

  useEffect(() => {
    if (!distinctId || !isPosthogEnabled()) return
    const serverKnowsOrganization = posthogIdentity?.organizationId === organizationId
    registerPosthogContext({
      organizationId,
      organizationName: serverKnowsOrganization ? posthogIdentity?.organizationName : null,
      role: serverKnowsOrganization ? posthogIdentity?.role : null,
      locale,
    })
  }, [distinctId, organizationId, posthogIdentity, locale])

  return null
}

const useThemeEffect = (theme: ThemeMode): void => {
  useLayoutEffect(() => {
    const applyDark = (isDark: boolean): void => {
      document.documentElement.classList.toggle('dark', isDark)
      const color = isDark ? THEME_COLOR.dark : THEME_COLOR.light
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', color))
    }

    const current = useLayoutStore.getState().theme
    if (current !== 'system') {
      applyDark(current === 'dark')
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    applyDark(mediaQuery.matches)
    const handleChange = (e: MediaQueryListEvent): void => applyDark(e.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])
}

const useDataSourcesInit = (): void => {
  const fetchDataSources = useLayoutStore((state) => state.fetchDataSources)
  const availableDataSources = useLayoutStore((state) => state.availableDataSources)

  useEffect(() => {
    if (availableDataSources === null) {
      fetchDataSources()
    }
  }, [fetchDataSources, availableDataSources])
}

const useDataSourceSessionRestore = (): void => {
  const availableDataSources = useLayoutStore((state) => state.availableDataSources)
  const setEnabledDataSources = useLayoutStore((state) => state.setEnabledDataSources)
  const conversationId = useChatStore((state) => state.currentConversation?.id)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current || !availableDataSources) return

    const conversation = useChatStore.getState().currentConversation
    if (!conversation) return

    const savedIds = conversation.enabledDataSourceIds
    if (savedIds) {
      const availableIds = new Set(availableDataSources.map((s) => s.id))
      const validIds = savedIds.filter((id) => availableIds.has(id))
      setEnabledDataSources(validIds)
    }

    restoredRef.current = true
  }, [availableDataSources, conversationId, setEnabledDataSources])
}

const useThemePreferenceSync = (): void => {
  const setTheme = useLayoutStore((state) => state.setTheme)
  const hydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void fetchUserPreferences()
      .then((prefs) => {
        if (!cancelled && isThemeMode(prefs.theme)) {
          setTheme(prefs.theme)
        }
      })
      .finally(() => {
        hydratedRef.current = true
      })
    return () => {
      cancelled = true
    }
  }, [setTheme])

  useEffect(() => {
    return useLayoutStore.subscribe((state, prev) => {
      if (!hydratedRef.current || state.theme === prev.theme) return
      void patchUserPreferences({ theme: state.theme })
    })
  }, [])
}

const ThemeWrapper = ({ children }: { children: ReactNode }): ReactNode => {
  const theme = useLayoutStore((state) => state.theme)

  useThemeEffect(theme)

  useThemePreferenceSync()

  useDataSourcesInit()

  useDataSourceSessionRestore()

  return <>{children}</>
}

const useConversationsInit = (): void => {
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    useChatStore.getState().loadServerConversations()
  }, [])
}

export const Providers = ({ children, config, locale }: ProvidersProps): ReactNode => {
  const content = (
    <ThemeWrapper>
      <ConversationsHydrator>
        {children}
      </ConversationsHydrator>
    </ThemeWrapper>
  )

  return (
    <AppConfigProvider config={config}>
      <I18nProvider initialLocale={locale}>
        <AuthKitProvider>
          {/* reducedMotion="user" disables transform/layout animations for users
              with prefers-reduced-motion, app-wide. */}
          <MotionConfig reducedMotion="user">
            {/* The primitive's delay (first tooltip waits, the next ones in a
                chain open at once); no app-wide override. */}
            <TooltipProvider>
              <PostHogIdentitySync />
              {content}
            </TooltipProvider>
            <Toaster />
          </MotionConfig>
        </AuthKitProvider>
      </I18nProvider>
    </AppConfigProvider>
  )
}

const ConversationsHydrator = ({ children }: { children: ReactNode }): ReactNode => {
  useConversationsInit()
  return <>{children}</>
}

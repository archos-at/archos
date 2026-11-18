'use client'

import { type ReactNode, Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAppConfig } from '@/shared/context'
import { useAuth } from '@/adapters/auth'
import { useTranslations } from '@/i18n'
import { errorsCopy } from '@/i18n/namespaces/errors'

const ErrorContent = (): ReactNode => {
  const router = useRouter()
  const { authRequired } = useAppConfig()
  const { signIn } = useAuth()
  const searchParams = useSearchParams()
  const t = useTranslations(errorsCopy)
  const error = searchParams?.get('error') || 'Default'
  const knownKeys = ['Configuration', 'AccessDenied', 'Verification', 'SessionExpired', 'Default']
  const messageKey = knownKeys.includes(error) ? error : 'Default'
  const errorMessage = t(`auth.messages.${messageKey}`)

  useEffect(() => {
    if (!authRequired) {
      router.replace('/')
    }
  }, [authRequired, router])

  if (!authRequired) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="default" label={t('auth.redirecting')} />
      </div>
    )
  }

  const handleRetry = (): void => {
    void signIn()
  }

  const handleHome = (): void => {
    window.location.href = '/'
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{t('auth.heading')}</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>

      <div className="flex gap-3">
        <Button size="default" onClick={handleRetry}>
          {t('auth.tryAgain')}
        </Button>
        <Button variant="secondary" size="default" onClick={handleHome}>
          {t('auth.goHome')}
        </Button>
      </div>
    </div>
  )
}

const AuthErrorPage = (): ReactNode => {
  const t = useTranslations(errorsCopy)
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted p-4 sm:p-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-8">
                <Spinner size="default" label={t('auth.loading')} />
              </div>
            }
          >
            <ErrorContent />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}

export default AuthErrorPage

import { redirect } from 'next/navigation'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { getUserSession } from '@/lib/auth/session'
import { runWithTenantSlot } from '@/lib/db/tenant-context'

const SIGN_IN_ROUTE = '/api/auth/signin'

interface HomePageProps {
  searchParams: Promise<{ 'sign-in'?: string | string[] }>
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<never> {
  return runWithTenantSlot(async () => {
    if (isAuthRequired()) {
      const session = await getUserSession()
      if (!session) {
        const wantsSignIn = 'sign-in' in (await searchParams)
        const landingUrl = process.env.LANDING_URL
        redirect(wantsSignIn || !landingUrl ? SIGN_IN_ROUTE : landingUrl)
      }
    }
    redirect('/app/projects')
  })
}

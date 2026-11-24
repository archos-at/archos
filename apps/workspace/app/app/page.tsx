import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LAST_PLACE_COOKIE, landingPath } from '@/components/shell/landing'

export default async function AppIndexPage(): Promise<never> {
  const lastPlace = (await cookies()).get(LAST_PLACE_COOKIE)?.value
  redirect(landingPath(lastPlace))
}

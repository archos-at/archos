import { publicSiteOrigin } from '@/shared/public-site'

export function configuredPublicSiteOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  return publicSiteOrigin(env.LANDING_URL)
}

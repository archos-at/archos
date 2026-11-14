/**
 * The public website's origin on the server: `LANDING_URL`, which Pulumi sets
 * to `https://<webDomain>` (`webOrigin` in `deploy/pulumi/src/config/ingress.ts`),
 * so the domain cutover moves it with no code change. The inbound-mail bounce
 * text and the help links in the UI (through `AppConfig.publicSiteUrl`) read it
 * here; the rule for what counts as an origin is `publicSiteOrigin`.
 */
import { publicSiteOrigin } from '@/shared/public-site'

/** The website's origin, or null when `LANDING_URL` is unset or not an origin. Read per call. */
export function configuredPublicSiteOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  return publicSiteOrigin(env.LANDING_URL)
}

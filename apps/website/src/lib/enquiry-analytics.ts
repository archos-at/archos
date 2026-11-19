import { webAnalyticsConfig } from '../../runtime/web-analytics.mjs';
import type { Enquiry } from './enquiry';

export type EnquiryOutcome = 'sent' | 'not_configured' | 'budget_spent' | 'send_failed' | 'invalid' | 'trap';

export interface EnquiryReport {
  outcome: EnquiryOutcome;
  form?: Enquiry['form'];
  locale?: Enquiry['locale'];
  confirmed?: boolean;
  attio?: 'off' | 'recorded' | 'failed';
  newsletter?: boolean;
}

type Env = Record<string, string | undefined>;

/** Personless and without anything the visitor typed: the property rules of docs/observability/posthog-events.md. */
export function enquiryEvent(report: EnquiryReport, env: Env) {
  const config = webAnalyticsConfig(env);
  if (!config) return undefined;
  return {
    url: `${config.host}/i/v0/e/`,
    body: {
      api_key: config.token,
      event: 'website_enquiry',
      distinct_id: 'website',
      properties: {
        ...report,
        site: 'website',
        service: 'website',
        ...(config.deployment ? { deployment: config.deployment } : {}),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    },
  };
}

export function captureEnquiry(report: EnquiryReport, env: Env = process.env, fetchFn: typeof fetch = fetch): void {
  const event = enquiryEvent(report, env);
  if (!event) return;
  fetchFn(event.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event.body),
    signal: AbortSignal.timeout(3_000),
  }).catch(() => undefined);
}

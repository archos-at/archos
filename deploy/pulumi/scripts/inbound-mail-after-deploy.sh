#!/usr/bin/env bash
# Project mail after `pulumi up` (ADR-0138), run by deploy.yml's deploy jobs on
# the stack the job just applied. Two commands, each a no-op with one summary
# line on a stack without project mail:
#
#   subaddress   switch the mail zone's subaddressing on, once. GET first, PATCH
#                `{"support_subaddress":true}` only when it is off, GET again,
#                and fail loudly when Cloudflare refuses. The zone's SETTINGS
#                endpoint, `PATCH /zones/<zone>/email/routing`: its `enabled`
#                field is a no-op, so it routes nothing and onboards nothing.
#                Never `…/email/routing/enable`, the apex's onboarding, which
#                beside Google Workspace's MX fails with 2008 or takes the
#                company's mail. Why not Pulumi: `platform/email-routing.ts`.
#   gates        the read-only launch gates that need no human mail: G7
#                (`inbound-mail-smoke.ts cloudflare`), and G3/G4 over the signed
#                route (`signed --run`, `--expect-paused` while the stack is
#                paused) when INBOUND_MAIL_TEST_ADDRESS names a project address
#                of the test office. Without it that half is skipped, said so.
#
# Run from deploy/pulumi with the stack selected and `pulumi` logged in. Reads
# the stack output `inboundMailCloudflare` (zone, account, domain, local part,
# Worker) and, from the stack's config (ESC), `cloudflareApiToken` (the deploy
# token: it has Zone Settings · Edit, and every read the gates make) and
# `inboundMailSigningKeys`. Secrets are masked before use and never printed.
# Writes a section to $GITHUB_STEP_SUMMARY when it is set.
#
# Exit status: 0 done or nothing to do, 1 a refusal or a failed gate.
set -euo pipefail

cmd="${1:-}"
case "$cmd" in subaddress | gates) ;; *) echo "usage: $0 subaddress|gates" >&2; exit 2 ;; esac

summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi; printf '%s\n' "$@"; }
mask() { if [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ]; then echo "::add-mask::$1"; fi; }

# Null when inboundMailDomain is unset; an error (an older program) reads the same.
mail="$(pulumi stack output inboundMailCloudflare --json 2>/dev/null || echo null)"
if [ "$(jq -r 'type' <<<"$mail")" != "object" ]; then
  summary "Project mail: not configured on this stack (inboundMailDomain unset); $cmd skipped."
  exit 0
fi
zone="$(jq -r .zoneId <<<"$mail")"
account="$(jq -r .accountId <<<"$mail")"
domain="$(jq -r .domain <<<"$mail")"
local_part="$(jq -r .localPart <<<"$mail")"
worker="$(jq -r '.worker // ""' <<<"$mail")"
paused="$(jq -r .paused <<<"$mail")"

token="$(pulumi config get cloudflareApiToken)"
mask "$token"

cf() { # method path [body]
  curl -sS --max-time 30 -X "$1" "https://api.cloudflare.com/client/v4$2" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" ${3:+--data "$3"}
}

if [ "$cmd" = subaddress ]; then
  read_setting() {
    local answer
    answer="$(cf GET "/zones/$zone/email/routing")"
    if [ "$(jq -r '.success' <<<"$answer")" != "true" ]; then
      # Inside $(…): to stderr, so the log shows it; the caller's errexit stops the script.
      summary "Project mail: subaddressing could not be read on zone \`$zone\`: $(jq -c '.errors' <<<"$answer")" >&2
      echo "::error::GET /zones/$zone/email/routing refused: $(jq -c '.errors' <<<"$answer")" >&2
      return 1
    fi
    jq -r '.result.support_subaddress' <<<"$answer"
  }
  before="$(read_setting)"
  if [ "$before" = "true" ]; then
    summary "Project mail: subaddressing already on for zone \`$zone\` ($domain); nothing changed."
    exit 0
  fi
  answer="$(cf PATCH "/zones/$zone/email/routing" '{"support_subaddress":true}')"
  after="$(read_setting)"
  if [ "$(jq -r '.success' <<<"$answer")" != "true" ] || [ "$after" != "true" ]; then
    echo "::error::Cloudflare refused subaddressing on zone $zone: $(jq -c '.errors' <<<"$answer"). Every project address bounces until it is on. Do NOT onboard the apex (…/email/routing/enable): this is risk B2 of the project-mail runbook; pause mail (inboundMailPaused) and decide D1 again."
    summary "Project mail: **subaddressing refused** on zone \`$zone\` ($domain): $(jq -c '.errors' <<<"$answer"). Runbook §0, risk B2."
    exit 1
  fi
  summary "Project mail: subaddressing switched on for zone \`$zone\` ($domain) (was \`$before\`)."
  exit 0
fi

# gates
summary "## Project mail gates ($domain)" ""
if [ -z "$worker" ]; then
  summary "Switched off (inboundMailEnabled=false): no Worker to check; gates skipped."
  exit 0
fi
status=0
run_gate() { # label, then the smoke tool's arguments
  local label="$1" out code
  shift
  set +e
  out="$(bun scripts/inbound-mail-smoke.ts "$@" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "$out"
  summary "**$label**: $([ "$code" = 0 ] && echo passed || echo "FAILED (exit $code)")" "" '```' "$out" '```' ""
  [ "$code" = 0 ] || status=1
}

export CLOUDFLARE_API_TOKEN="$token" INBOUND_MAIL_ZONE_ID="$zone" INBOUND_MAIL_ACCOUNT_ID="$account" \
  INBOUND_MAIL_DOMAIN="$domain" INBOUND_MAIL_LOCAL_PART="$local_part" INBOUND_MAIL_WORKER="$worker"
run_gate "G7, the rules and the Worker at Cloudflare (cloudflare)" cloudflare

if [ -z "${INBOUND_MAIL_TEST_ADDRESS:-}" ]; then
  summary "**G3/G4, the signed route**: skipped. Set the secret \`INBOUND_MAIL_TEST_ADDRESS\` of this job's GitHub environment to a project address of the test office (never a customer's) and the next deploy runs it."
  exit "$status"
fi
keys="$(pulumi config get inboundMailSigningKeys)"
key_id="$(pulumi config get inboundMailSigningKeyId 2>/dev/null || jq -r 'keys | if length == 1 then .[0] else "" end' <<<"$keys")"
secret="$(jq -r --arg k "$key_id" '.[$k] // ""' <<<"$keys")"
mask "$secret"
if [ -z "$secret" ]; then
  echo "::error::no signing key for keyid '$key_id' in inboundMailSigningKeys"
  summary "**G3/G4, the signed route**: FAILED, no signing key for keyid \`$key_id\`."
  exit 1
fi
unset keys
origin="$(pulumi stack output appUrl)"
export INBOUND_MAIL_APP_ORIGIN="$origin" INBOUND_MAIL_KEY_ID="$key_id" INBOUND_MAIL_SIGNING_KEY="$secret"
if [ "$paused" = "true" ]; then
  run_gate "G4, the signed route while paused (signed --run --expect-paused)" signed --run --expect-paused
else
  run_gate "G3, the signed route (signed --run): its probes wait in the test project, from an outside sender, and expire after 14 days" signed --run
fi
exit "$status"

#!/usr/bin/env bash
# Can a stack's Cloudflare token manage these zones? Answers it against the API,
# per zone: can the token see the zone (and what is its id), read its records,
# write one, and read the redirect rules the baseline stack owns.
#
#   deploy/pulumi/scripts/check-cloudflare-token.sh [--stack dev|prod] [--read-only] [zone ...]
#
# The token is CLOUDFLARE_API_TOKEN when set, otherwise the stack's own
# `cloudflareApiToken`, read with `pulumi config get` (needs `pulumi login` with
# access to the stack). It is not in the cluster: Pulumi writes the records, not
# a pod. Zones default to the brand's domain (packages/brand/identity.json), the
# zone prod serves (Pulumi.prod.yaml `dnsZoneName`), and the checked stack's own
# `dnsZoneName` and `formerDnsZoneName`, each once: the zones a domain move needs
# one token to edit (docs/deployment/domain-cutover.md).
#
# The write check adds a TXT record `_token-check-<random>.<zone>` and deletes it
# again at once; --read-only skips it. Needs curl and jq. Exit 1 when any zone
# fails a check.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
API="https://api.cloudflare.com/client/v4"
STACK="dev"
READ_ONLY=0
ZONES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="$2"; shift 2 ;;
    --read-only) READ_ONLY=1; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ZONES+=("$1"); shift ;;
  esac
done

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "needs $tool on the PATH" >&2; exit 2; }
done

PROJECT="$(sed -n 's/^name: *//p' "$HERE/Pulumi.yaml")"
# A plaintext key of a committed stack file, or nothing.
stack_key() { [[ -f "$HERE/Pulumi.$1.yaml" ]] && sed -n "s/^  $PROJECT:$2: *//p" "$HERE/Pulumi.$1.yaml" | tr -d "\"'" | head -n1 || true; }

if [[ ${#ZONES[@]} -eq 0 ]]; then
  # The brand's domain, the zone prod serves, and the checked stack's own zone and former
  # zone: once prod has moved, the first two coincide and the former zone still needs edits.
  for zone in "$(jq -r .domain "$ROOT/packages/brand/identity.json")" "$(stack_key prod dnsZoneName)" \
    "$(stack_key "$STACK" dnsZoneName)" "$(stack_key "$STACK" formerDnsZoneName)"; do
    [[ -n "$zone" && " ${ZONES[*]-} " != *" $zone "* ]] && ZONES+=("$zone")
  done
fi
# The stack writes the redirect ruleset only into its own zone, and only with the baseline.
BASELINE_ZONE=""
if [[ "$(stack_key "$STACK" dnsZoneBaseline)" == "true" ]]; then
  BASELINE_ZONE="$(stack_key "$STACK" dnsZoneName)"
fi

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "reading $PROJECT:cloudflareApiToken from stack '$STACK'"
  TOKEN="$(cd "$HERE" && pulumi config get "$PROJECT:cloudflareApiToken" --stack "$STACK")"
fi

# GET/POST/DELETE against the API; prints the body, never the token.
cf() {
  local method="$1" path="$2" body="${3:-}"
  curl -sS -X "$method" "$API$path" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}
errors() { jq -r '[.errors[]? | "\(.code) \(.message)"] | join("; ")'; }

echo
echo "== token"
verify="$(cf GET /user/tokens/verify)"
ACCOUNT_VERIFIED=0
if [[ "$(jq -r .success <<<"$verify")" == "true" ]]; then
  jq -r '.result | "user token: status \(.status), expires \(.expires_on // "never")"' <<<"$verify"
  ACCOUNT_VERIFIED=1
else
  # An account-owned token answers only on its account's endpoint, which needs the account
  # id: the first zone the token can see names it (below).
  echo "not a user token; checking it as an account token on the first visible zone's account"
fi

failed=0
# The probe record of the zone being checked, deleted on any exit until the normal path has.
probe_id=""
probe_zone=""
cleanup() {
  if [[ -n "$probe_id" ]]; then
    cf DELETE "/zones/$probe_zone/dns_records/$probe_id" >/dev/null || true
    echo "      removed the probe record on exit"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for zone in "${ZONES[@]}"; do
  echo
  echo "== $zone"
  zones="$(cf GET "/zones?name=$zone")"
  id="$(jq -r '.result[0].id // empty' <<<"$zones")"
  if [[ -z "$id" ]]; then
    echo "FAIL  the token cannot see this zone. $(errors <<<"$zones")"
    echo "      Cloudflare → My Profile (or the account) → API Tokens → this token → Edit →"
    echo "      Zone Resources: add $zone. The token's value does not change."
    failed=1
    continue
  fi
  if [[ "$ACCOUNT_VERIFIED" -eq 0 ]]; then
    account="$(jq -r '.result[0].account.id // empty' <<<"$zones")"
    averify="$(cf GET "/accounts/$account/tokens/verify")"
    if [[ "$(jq -r .success <<<"$averify")" == "true" ]]; then
      jq -r '.result | "ok    account token: status \(.status), expires \(.expires_on // "never")"' <<<"$averify"
    else
      echo "WARN  token verify on account $account: $(errors <<<"$averify")"
    fi
    ACCOUNT_VERIFIED=1
  fi
  jq -r '.result[0] | "ok    visible: zone id \(.id), status \(.status), account \(.account.name), nameservers \(.name_servers | join(" "))"' <<<"$zones"

  records="$(cf GET "/zones/$id/dns_records?per_page=500")"
  if [[ "$(jq -r .success <<<"$records")" != "true" ]]; then
    echo "FAIL  DNS read: $(errors <<<"$records")"
    failed=1
    continue
  fi
  echo "ok    DNS read: $(jq '.result | length' <<<"$records") records"
  jq -r '.result | sort_by(.name, .type)[] | "        \(.type)\t\(.name)\t\(.content)\(if .proxied then "  (proxied)" else "" end)"' <<<"$records"

  if [[ "$READ_ONLY" -eq 0 ]]; then
    probe="_token-check-$RANDOM$RANDOM.$zone"
    created="$(cf POST "/zones/$id/dns_records" \
      "$(jq -nc --arg n "$probe" '{type:"TXT", name:$n, content:"\"token check, deleted at once\"", ttl:60}')")"
    probe_zone="$id"
    probe_id="$(jq -r '.result.id // empty' <<<"$created")"
    if [[ -z "$probe_id" ]]; then
      echo "FAIL  DNS edit: $(errors <<<"$created"). The token needs Zone → DNS → Edit on $zone."
      failed=1
    else
      deleted="$(cf DELETE "/zones/$id/dns_records/$probe_id")"
      if [[ "$(jq -r .success <<<"$deleted")" == "true" ]]; then
        probe_id=""
        echo "ok    DNS edit: created and deleted $probe"
      else
        probe_id=""
        echo "FAIL  DNS edit: created $probe but could not delete it: $(errors <<<"$deleted"). Delete it by hand."
        failed=1
      fi
    fi
  fi

  # Only the stack with dnsZoneBaseline writes this ruleset (the www redirect), and only
  # in its own zone. 200 and 404 show the endpoint is readable, not that the token may
  # edit it; anything else there is a FAIL, elsewhere a note.
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
    "$API/zones/$id/rulesets/phases/http_request_dynamic_redirect/entrypoint")"
  case "$code" in
    200) echo "ok    redirect rules: readable, a ruleset exists" ;;
    404) echo "ok    redirect rules: readable, none yet" ;;
    *)
      if [[ "$zone" == "$BASELINE_ZONE" ]]; then
        echo "FAIL  redirect rules: HTTP $code. Stack '$STACK' owns this zone's baseline and needs Zone → Dynamic URL Redirects → Edit."
        failed=1
      else
        echo "WARN  redirect rules: HTTP $code. Only the zone-baseline stack needs Zone → Dynamic URL Redirects → Edit."
      fi ;;
  esac
done

echo
if [[ "$failed" -eq 0 ]]; then
  echo "The token can manage every zone above."
else
  echo "The token cannot manage every zone above; see FAIL."
fi
exit "$failed"

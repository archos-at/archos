#!/usr/bin/env bash
# Preview a pull request's program against staging, with the images and the
# PostHog release staging runs now, so the plan shows what the program change
# does and nothing a deploy would change anyway.
#
# Usage: preview-pull-request.sh   (inside deploy/pulumi; PULUMI_ACCESS_TOKEN set)
# Writes .plan.json, validates its custom resources (validate-crs.mjs) and
# summarizes it (summarize-plan.mjs), into $GITHUB_STEP_SUMMARY when set.
# Nothing here writes to the stack: `pulumi config set` changes only the
# checkout's Pulumi.dev.yaml, and a preview applies nothing.
#
# Environment:
#   STACK              default matthiasbigl/grid-oib/dev
#   ALLOW_STATE_LOSS   1 accepts a plan that replaces or deletes data
set -euo pipefail

STACK="${STACK:-matthiasbigl/grid-oib/dev}"
pulumi stack select "$STACK"

deployed="$(pulumi stack output deployedImages --json)"
ref() { jq -r --arg s "$1" '.[$s] // empty' <<<"$deployed"; }
backend="$(ref backend)"
if [ -z "$backend" ]; then
  echo "::error::$STACK has no deployedImages.backend; deploy develop once before previewing pull requests" >&2
  exit 1
fi

set_if() { [ -z "$2" ] || pulumi config set "$1" "$2"; }
pulumi config set grid-oib:imageTag "${backend##*:}"
pulumi config set grid-oib:backendImage "$backend"
set_if grid-oib:frontendImage "$(ref frontend)"
set_if grid-oib:webImage "$(ref web)"
set_if cmsImage "$(ref cms)"
set_if grid-oib:codeRunnerImage "$(ref code-runner)"
set_if grid-oib:browserRendererImage "$(ref browser-renderer)"
release="$(pulumi stack export | jq -r '[.deployment.resources[]?.outputs.spec.template.spec.containers[]?.env[]? | select(.name == "POSTHOG_RELEASE_ID") | .value] | first // empty')"
set_if grid-oib:posthogReleaseId "$release"

if ! pulumi preview --policy-pack ./policy --json > .plan.json; then
  echo "::error::pulumi preview failed; the text run below names the reason"
  pulumi preview --policy-pack ./policy || true
  exit 1
fi
node scripts/validate-crs.mjs .plan.json
node scripts/summarize-plan.mjs .plan.json "${GITHUB_STEP_SUMMARY:-}"

#!/usr/bin/env bash
# Write the Pulumi.prod.yaml a promotion to prod carries.
#
# Usage: promote-stack-file.sh <base> <develop> <prod> <tag>   (prints the file on stdout)
#   <base>     develop's Pulumi.prod.yaml at the commit prod runs now (the last promotion)
#   <develop>  develop's Pulumi.prod.yaml at the commit being promoted
#   <prod>     prod's Pulumi.prod.yaml as it is on the `prod` branch
#   <tag>      the pin, sha-<40 hex>
# Exits 1, with the conflicting lines on stderr, when prod and develop changed
# the same lines since the last promotion (or two neighbouring lines, one each:
# `git merge-file` takes those as one hunk): a person decides those.
#
# A three-way merge, not "prod wins": prod's file is develop's of the last
# promotion plus what prod changed on its own branch (`mcpGatewayEnabled`
# turned off for one promotion, say). Those changes are carried over; every
# change develop made since (a larger volume, a new tier's settings) comes
# with the promotion. Taking prod's value on every differing line would undo
# develop's; taking develop's file whole would drop prod's, and its stale pin
# with it (develop's copy pins whatever the last promotion left there).
#
# The `imageTag` line, whatever its project prefix, is set to <tag> whatever
# the three say: it is the promotion. It is blanked in all three before the
# merge so a pin that moved on both sides never conflicts.
set -euo pipefail

base="${1:?usage: promote-stack-file.sh <base> <develop> <prod> <tag>}"
develop="${2:?develop}"
prod="${3:?prod}"
tag="${4:?tag}"
[[ "$tag" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "::error::the pin must be sha-<40 hex>, not '$tag'" >&2; exit 1; }

PIN='^(  [a-z-]+:imageTag:).*$'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for side in base develop prod; do
  src="${!side}"
  [ "$(grep -cE "$PIN" "$src" || true)" = 1 ] || {
    echo "::error::${side}'s Pulumi.prod.yaml ($src) has no single imageTag line" >&2
    exit 1
  }
  sed -E "s/${PIN}/\\1 PIN/" "$src" > "$work/$side"
done

rc=0
git merge-file -p -L develop -L base -L prod "$work/develop" "$work/base" "$work/prod" > "$work/merged" || rc=$?
if [ "$rc" -ne 0 ]; then
  echo "::error::Pulumi.prod.yaml: prod and develop changed the same lines since the last promotion (${rc} conflict(s)). Resolve them in the promotion branch by hand:" >&2
  grep -nE '^(<<<<<<<|=======|>>>>>>>)' -A3 "$work/merged" >&2 || true
  exit 1
fi
sed -E "s/${PIN}/\\1 ${tag}/" "$work/merged"

#!/usr/bin/env bash
# Refuse a push-triggered prod deploy whose pinned image is older than what
# prod runs.
#
# Usage: prod-downgrade-guard.sh <pinned tag>   (run inside the checkout, prod stack selected)
# Environment:
#   GITHUB_REPOSITORY  owner/repo, for the commit-date lookup through the API
#   GH_TOKEN           a token with `contents: read`, for the same
# Needs `git` (checkout with `fetch-depth: 0`), `pulumi` with the stack
# selected, `jq`, and `gh` only when a commit is not in the checkout.
# Exits 0 when every service's pinned commit is the running one or newer, 1
# with an ::error:: naming both refs when it is older or cannot be told.
#
# Why: develop's own copy of Pulumi.prod.yaml pins whatever tag the last
# promotion left there (in November 2026, a September build). A promotion that
# took that line unchanged rolled prod back two months with nothing red. The
# staging job has had a guard since 09-28 (resolve-image-refs.sh); this is the
# same check for the tag prod's stack file pins.
#
# "Older", in order of what the checkout can answer:
#   1. git ancestry: the running commit is an ancestor of the pin (or equal):
#      allowed; the pin is an ancestor of the running commit: refused;
#   2. otherwise (one commit is not in the checkout, or the two are not on one
#      line, as after a history rewrite: prod ran sha-331b9d91…, which is the
#      content of develop 8cb6cf646 but on no branch): committer dates, from
#      git where it has the commit and from the GitHub API where it does not
#      (a rewritten commit stays readable there by sha). An earlier pin is
#      refused; the same second is allowed (a rewrite keeps the date).
# Commit dates rather than the images' `org.opencontainers.image.created`
# label: images are named by their inputs (ci/image_inputs.py), so a commit
# that changes nothing in an image reuses one built for an earlier commit, and
# its creation date says nothing about the commit.
#
# An operator rollback (a dispatch with imageTag) never reaches this script:
# going back is what it is for.
set -euo pipefail

pinned="${1:?usage: prod-downgrade-guard.sh <pinned tag>}"

log() { printf '%s\n' "$*" >&2; }

commit_of() {
  local tag="${1##*:}"
  [[ "$tag" =~ ^sha-([0-9a-f]{40})$ ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

in_checkout() { git cat-file -e "${1}^{commit}" 2>/dev/null; }

# Committer date of a commit in seconds since the epoch; empty when unknown.
date_of() {
  local sha="$1" iso
  if in_checkout "$sha"; then
    git show -s --format=%ct "$sha"
    return 0
  fi
  iso="$(gh api "repos/${GITHUB_REPOSITORY:?}/commits/${sha}" --jq '.commit.committer.date' 2>/dev/null || true)"
  [ -n "$iso" ] && date -u -d "$iso" +%s 2>/dev/null || true
}

when() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

new="$(commit_of "$pinned")"
if [ -z "$new" ]; then
  log "::warning::Pulumi.prod.yaml pins '${pinned}', not a sha-<40 hex> tag; cannot check it is not a downgrade."
  exit 0
fi

deployed_json="$(pulumi stack output deployedImages --json 2>/dev/null || true)"
[ -n "$deployed_json" ] || deployed_json="{}"

failed=0
for service in backend frontend web; do
  deployed="$(jq -r --arg s "$service" '.[$s] // empty' <<<"$deployed_json")"
  old="$(commit_of "$deployed")"
  if [ -z "$old" ]; then
    log "::warning::${service}: prod runs '${deployed:-nothing recorded}', not a sha-<40 hex> tag; cannot check the pin is not a downgrade."
    continue
  fi
  [ "$old" != "$new" ] || { log "${service}: runs the pinned ${pinned}"; continue; }

  if in_checkout "$old" && in_checkout "$new"; then
    if git merge-base --is-ancestor "$old" "$new"; then
      log "${service}: ${deployed} -> ${pinned} (a descendant)"
      continue
    fi
    if git merge-base --is-ancestor "$new" "$old"; then
      log "::error::${service}: refusing to downgrade prod. It runs ${deployed}, and the pinned ${pinned} is an ancestor of it."
      failed=1
      continue
    fi
  fi

  old_date="$(date_of "$old")"
  new_date="$(date_of "$new")"
  if [ -z "$old_date" ] || [ -z "$new_date" ]; then
    log "::error::${service}: prod runs ${deployed}, which is not on the pinned commit's history, and the commit date of $([ -z "$old_date" ] && echo "$old" || echo "$new") could not be read; cannot tell whether ${pinned} is older."
    failed=1
    continue
  fi
  if [ "$new_date" -lt "$old_date" ]; then
    log "::error::${service}: refusing to downgrade prod. It runs ${deployed} (committed $(when "$old_date")), and the pinned ${pinned} was committed earlier ($(when "$new_date"))."
    failed=1
    continue
  fi
  log "${service}: ${deployed} -> ${pinned} (not on one history; committed $(when "$old_date") -> $(when "$new_date"))"
done

if [ "$failed" -ne 0 ]; then
  log "::error::Pin a newer develop commit in deploy/pulumi/Pulumi.prod.yaml, or, to go back on purpose, roll back by hand: gh workflow run deploy.yml --ref develop -f target=prod -f imageTag=${pinned} (docs/deployment/rollback.md)."
  exit 1
fi

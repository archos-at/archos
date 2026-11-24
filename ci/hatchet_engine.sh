#!/usr/bin/env bash
# A throwaway Hatchet engine for CI's `Hatchet engine tests` job (ci.yml): the
# same hatchet-lite + Postgres pair deploy/compose runs under its `hatchet`
# profile, started with `docker run` so the engine starts only once its
# database answers (a service container cannot wait for another one).
#
#   ci/hatchet_engine.sh start            engine up and healthy, a token made,
#                                         HATCHET_CLIENT_* written to $GITHUB_ENV
#   ci/hatchet_engine.sh logs             both containers' logs, for a failed run
#   ci/hatchet_engine.sh require-ran X..  fail when a JUnit report X holds no
#                                         test, or a skipped one (an expected
#                                         failure ran, so it does not count)
#
# `require-ran` exists because every engine suite skips without an engine, and a
# skipped suite is green: without it, a token that never reached the tests would
# pass this job exactly as these suites passed before it existed. The
# `agent-engine` job calls it for the same reason, about the IFC engine.
set -euo pipefail

# The tag Kubernetes runs (HATCHET_IMAGE_TAG, deploy/pulumi/src/config/background-work.ts)
# and Compose pins; tests/test_ci_workflows.py holds the three together.
HATCHET_IMAGE="ghcr.io/hatchet-dev/hatchet/hatchet-lite:v0.114.2"
# deploy/compose/docker-compose.yaml's `hatchet-postgres`.
POSTGRES_IMAGE="postgres:16-alpine"
NETWORK=hatchet-ci
# The tenant `hatchet-admin quickstart` seeds, from Hatchet's Docker Compose
# guide (https://docs.hatchet.run/self-hosting/docker-compose, "token create").
DEFAULT_TENANT_ID="707d0855-80ab-4e1f-a156-f1c4546cbf52"
WAIT_SECONDS=180

start() {
  docker network create "$NETWORK" >/dev/null
  docker run -d --name hatchet-postgres --network "$NETWORK" \
    -e POSTGRES_USER=hatchet -e POSTGRES_PASSWORD=hatchet -e POSTGRES_DB=hatchet \
    "$POSTGRES_IMAGE" postgres -c max_connections=200 >/dev/null
  wait_until "Postgres to accept connections" \
    docker exec hatchet-postgres pg_isready -q -d hatchet -U hatchet

  # Every address is 127.0.0.1, one address family whatever a host's resolver
  # makes of localhost.
  # The environment is deploy/compose's hatchet-lite, which follows
  # https://docs.hatchet.run/self-hosting/hatchet-lite, with every address the
  # runner's own: the tests and their workers run on the host, not on the
  # network. 8733 is the engine's health port (the hatchet-ha chart probes
  # /ready there); published so the wait below can ask it.
  docker run -d --name hatchet-lite --network "$NETWORK" \
    -p 127.0.0.1:8888:8888 -p 127.0.0.1:7077:7077 -p 127.0.0.1:8733:8733 \
    -e DATABASE_URL="postgresql://hatchet:hatchet@hatchet-postgres:5432/hatchet?sslmode=disable" \
    -e SERVER_AUTH_COOKIE_DOMAIN=localhost \
    -e SERVER_AUTH_COOKIE_INSECURE=t \
    -e SERVER_GRPC_BIND_ADDRESS=0.0.0.0 \
    -e SERVER_GRPC_INSECURE=t \
    -e SERVER_GRPC_BROADCAST_ADDRESS=127.0.0.1:7077 \
    -e SERVER_GRPC_PORT=7077 \
    -e SERVER_URL=http://127.0.0.1:8888 \
    -e SERVER_AUTH_SET_EMAIL_VERIFIED=t \
    -e SERVER_INTERNAL_CLIENT_INTERNAL_GRPC_BROADCAST_ADDRESS=127.0.0.1:7077 \
    "$HATCHET_IMAGE" >/dev/null
  wait_until "the Hatchet engine to report ready" engine_ready

  # `token create` with the config the image's start script generated into
  # ./config (hack/lite/start.sh), run from the image's working directory as that
  # script is. It prints the token; the pattern drops any log line around it.
  local output token
  output="$(docker exec hatchet-lite ./hatchet-admin token create \
    --config ./config --tenant-id "$DEFAULT_TENANT_ID" --name ci 2>&1)"
  token="$(grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<<"$output" | tail -1 || true)"
  if [ -z "$token" ]; then
    echo "error: hatchet-admin token create printed no token:" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "::add-mask::$token"
  {
    echo "HATCHET_CLIENT_TOKEN=$token"
    echo "HATCHET_CLIENT_HOST_PORT=127.0.0.1:7077"
    echo "HATCHET_CLIENT_SERVER_URL=http://127.0.0.1:8888"
    echo "HATCHET_CLIENT_TLS_STRATEGY=none"
  } >>"${GITHUB_ENV:-/dev/stdout}"
  echo "Hatchet engine ready on 127.0.0.1:7077, token for tenant $DEFAULT_TENANT_ID exported."
}

# Ready once the API answers its readiness route (/api/ready, the chart's API
# probe, through the lite container's one HTTP port) or the engine answers its
# own (/ready on 8733). Either needs migrations and the generated config, which
# is what `token create` reads; the tests retry their first trigger until the
# worker has registered, so registration lag is theirs to wait out.
engine_ready() {
  curl -fsS -o /dev/null http://127.0.0.1:8888/api/ready 2>/dev/null \
    || curl -fsS -o /dev/null http://127.0.0.1:8733/ready 2>/dev/null
}

wait_until() {
  local what="$1"
  shift
  local deadline=$((SECONDS + WAIT_SECONDS))
  until "$@"; do
    if [ "$(docker inspect -f '{{.State.Running}}' hatchet-lite 2>/dev/null || echo absent)" = false ]; then
      echo "error: hatchet-lite exited while waiting for $what" >&2
      logs
      exit 1
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "error: timed out after ${WAIT_SECONDS}s waiting for $what" >&2
      logs
      exit 1
    fi
    sleep 2
  done
}

logs() {
  for name in hatchet-lite hatchet-postgres; do
    echo "::group::docker logs $name"
    docker logs "$name" 2>&1 | tail -300 || true
    echo "::endgroup::"
  done
}

require_ran() {
  python3 - "$@" <<'PY'
import sys
import xml.etree.ElementTree as ET

failed = False
for path in sys.argv[1:]:
    cases = list(ET.parse(path).getroot().iter("testcase"))
    # An expected failure ran; JUnit writes it as a skip all the same.
    skipped = [
        case.get("name")
        for case in cases
        if (skip := case.find("skipped")) is not None and skip.get("type") != "pytest.xfail"
    ]
    print(f"{path}: {len(cases)} tests, {len(skipped)} skipped")
    if not cases or skipped:
        failed = True
        print(f"::error::{path} ran no test or skipped {skipped}: the engine never reached it", file=sys.stderr)
sys.exit(1 if failed else 0)
PY
}

case "${1:-}" in
  start) start ;;
  logs) logs ;;
  require-ran) shift; require_ran "$@" ;;
  *) echo "usage: $0 start | logs | require-ran <junit.xml>..." >&2; exit 2 ;;
esac

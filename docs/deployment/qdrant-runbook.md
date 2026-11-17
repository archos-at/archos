# Qdrant runbook

How to operate the self-hosted Qdrant cluster (ADR-0115): see that it is
healthy, get it back when it is not, change its shape, upgrade it and rotate
its key. The manifests are
`deploy/pulumi/src/data/qdrant.ts`; the reasoning behind every setting is
[`qdrant-retrieval-design.md`](../architecture/qdrant-retrieval-design.md) §9.

Every procedure here says whether it was **drilled** and how long it took.
The drill ran on 2026-10-13 against real `qdrant/qdrant:v1.19.2` containers
in the shape the StatefulSet creates; [Drill log](#drill-log) says what it
was, how it differed from a cluster, and what it found. A step marked
**undrilled** has never been run; read it twice and do it on a copy first.

## Secrets and settings to set before the first deploy

Qdrant is self-hosted: no vendor account, no bought key. Every value below
is one you generate yourself and keep in the stack's ESC environment
(`matthiasbigl/grid-oib/dev` for staging, `matthiasbigl/grid-oib/prod` for
prod). Do this once per environment, before the deploy that brings Qdrant.

**1. Three Qdrant secrets. Required:** `pulumi preview` fails without any of
them, and fails if two are equal.

| Key | What it is | Must differ from |
|---|---|---|
| `qdrantApiKey` | Qdrant's admin password (`service.api_key`): every backend tier reads and writes with it | `qdrantReadOnlyApiKey` |
| `qdrantReadOnlyApiKey` | A password that can only search; for read-only callers and for looking in the dashboard | `qdrantApiKey` |
| `qdrantS3SecretKey` | Not a Qdrant key: the login of the `grid-qdrant` identity in our SeaweedFS, which stores the nightly snapshots | `seaweedfsSecretKey`, `seaweedfsBackendReadSecretKey`, `seaweedfsTenantAdminSecretKey`, `langfuseS3SecretKey` |

```bash
ENV=matthiasbigl/grid-oib/dev   # or matthiasbigl/grid-oib/prod
esc env set $ENV pulumiConfig.grid-oib:qdrantApiKey         "$(openssl rand -base64 32)" --secret
esc env set $ENV pulumiConfig.grid-oib:qdrantReadOnlyApiKey "$(openssl rand -base64 32)" --secret
esc env set $ENV pulumiConfig.grid-oib:qdrantS3SecretKey    "$(openssl rand -base64 32)" --secret
```

Each command generates a fresh random value, so running them as written gives
three different values. Run each once: running one again replaces the key, and
replacing `qdrantApiKey` on a live cluster is a rotation
([Rotate the API key](#rotate-the-api-key)), not a re-run. `qdrantAltApiKey`
exists only during that rotation; do not set it now.

**2. The dashboard's sign-in. Already set** wherever Langfuse signs in: the
dashboard reuses the platform WorkOS Connect application.

| Key | Where | Status |
|---|---|---|
| `otelOidcIssuer` | plain config in `Pulumi.<stack>.yaml` | set on dev and prod |
| `otelOidcClientId` | plain config in `Pulumi.<stack>.yaml` | set on dev and prod |
| `otelOidcClientSecret` | ESC, secret | set where Langfuse's sign-in works |

The one new step is in the WorkOS dashboard, not a secret: add
`https://qdrant.<baseDomain>/oauth2/callback` as a redirect URI on that
application (`https://qdrant.dev.piloti.at/oauth2/callback` for staging,
`https://qdrant.piloti.at/oauth2/callback` for prod). The dashboard is on by
default, so do it before the deploy ([Dashboard](#on-a-public-host)).

**Check before deploying**, without printing a value:

```bash
cd deploy/pulumi
pulumi config --stack dev | grep -E 'qdrant(ApiKey|ReadOnlyApiKey|S3SecretKey)|otelOidc'
# each line shows the key with [secret] or its plain value; a missing line is a missing key
pulumi preview --stack dev   # names any missing or colliding key
```

**Compose** needs none of this: it runs Qdrant without a key on its internal
network.

## Before you start

The commands use these names, which are the ones Pulumi creates:

| What | Name |
|---|---|
| Namespace | `grid` |
| Peers (pods) | `qdrant-0`, `qdrant-1`, `qdrant-2` (StatefulSet `qdrant`) |
| Peer REST URL | `http://qdrant-N.qdrant-headless.grid.svc.cluster.local:6333` |
| Peer p2p URI (how peers name each other) | `http://qdrant-N.qdrant-headless.grid:6335/` |
| Peer metrics (no key) | `qdrant-N.qdrant-headless.grid.svc.cluster.local:6336/metrics` |
| Client URL (load-balanced) | `http://qdrant.grid.svc.cluster.local:6333` |
| Keys | Secret `qdrant-credentials`: `api-key`, `read-only-api-key`, `s3-secret-key` (and `alt-api-key` during a rotation) |
| Snapshot bucket | `qdrant-snapshots` in the in-cluster SeaweedFS, identity `grid-qdrant` |
| Collections | `piloti_office_v1` behind alias `piloti_office`, `piloti_corpus_v1` behind `piloti_corpus` |
| Web dashboard | `https://qdrant.<baseDomain>/dashboard`, on by default where the `otelOidc*` keys are set, or `http://localhost:6333/dashboard` through a port-forward ([Dashboard](#dashboard)) |

**Reach the peers from inside the namespace.** The NetworkPolicies admit only
named callers to Qdrant (`allow-app-to-qdrant`). `qdrant-ops` is the one
reserved for people: a throwaway pod with that label can reach every peer's
client port, carries the keys from the Secret (never on a command line), and
is deleted when you are done.

```bash
kubectl -n grid apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: qdrant-ops
  labels: { app.kubernetes.io/name: qdrant-ops }
spec:
  restartPolicy: Never
  securityContext: { runAsNonRoot: true, runAsUser: 100, runAsGroup: 100 }
  containers:
    - name: ops
      image: curlimages/curl:8.16.0
      command: ["sleep", "14400"]
      env:
        - { name: QDRANT_API_KEY, valueFrom: { secretKeyRef: { name: qdrant-credentials, key: api-key } } }
        - { name: S3_SECRET_KEY, valueFrom: { secretKeyRef: { name: qdrant-credentials, key: s3-secret-key } } }
      securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: [ALL] } }
EOF
kubectl -n grid wait --for=condition=Ready pod/qdrant-ops
kubectl -n grid exec -it qdrant-ops -- sh
```

Inside it, define these once; every command below assumes them:

```sh
P0=http://qdrant-0.qdrant-headless.grid.svc.cluster.local:6333
P1=http://qdrant-1.qdrant-headless.grid.svc.cluster.local:6333
P2=http://qdrant-2.qdrant-headless.grid.svc.cluster.local:6333
q()  { curl -fsS -H "api-key: $QDRANT_API_KEY" -H 'content-type: application/json' "$@"; echo; }
# The S3 endpoint the CronJob uses (`http://seaweedfs:8333` on the single topology):
S3=http://seaweedfs:8333
s3() { curl -fsS --aws-sigv4 'aws:amz:us-east-1:s3' --user "grid-qdrant:$S3_SECRET_KEY" "$@"; }
```

`kubectl -n grid get cronjob qdrant-snapshot -o jsonpath='{..env[?(@.name=="S3_ENDPOINT")].value}'`
prints the S3 endpoint if it is not `http://seaweedfs:8333`. Delete the pod
afterwards: `kubectl -n grid delete pod qdrant-ops`.

**Which peer id is which pod.** Qdrant names peers by id; snapshots and every
shard operation use the id. `q $P0/cluster` lists `peers` as id → URI, and
the URI carries the pod name.

## Health at a glance

```sh
q $P0/cluster                                  # peers, Raft term/commit, pending_operations, leader
q $P0/collections/piloti_office/cluster        # this peer's shards and their state; remote_shards for the rest
q $P0/quotas                                   # quota config and this peer's resident_memory_percent, disk_usage_percent
q $P0/aliases
q -X POST -d '{"exact":true}' $P0/collections/piloti_office/points/count
```

A shard's replicas are `Active`, `Dead`, `Partial` or `Recovery`, and only
`Active` serves reads. `local_shards[].points_count` per peer is how two
replicas of one shard are compared (see [Resync replicas](#resync-replicas-after-a-peer-outage)).

**Metrics.** Each peer serves `/metrics` on port 6336 without the key and
nothing else on that port; on 6333 the same path answers 401 without one. The
OTel collector scrapes every peer there (job `qdrant`, label `peer`) and
re-exposes the series on `otel-collector:8889/metrics`. No metrics backend
runs yet, so read them by hand:

```bash
kubectl -n grid port-forward svc/otel-collector 8889:8889 &
curl -s localhost:8889/metrics | grep -E '^(up|collection_dead_replicas|collection_active_replicas_min|cluster_pending_operations_total|quota_exceeded)\{' | sed 's/{.*peer="\([^"]*\)".*}/ \1/'
```

**Alerts.** The rules are in the ConfigMap `qdrant-alert-rules`
(`qdrant.rules.yaml`, rendered by `deploy/pulumi/src/data/qdrant-alerts.ts`
against the stack's memory limit). **They are inert: nothing stores the
metrics and nothing evaluates the rules, on staging or anywhere else.** The
collector only re-exposes the scrape on `otel-collector:8889/metrics`; no
series is kept and no one is paged when a peer goes down. Each rule's `check`
annotation is the by-hand command meanwhile.

**Connecting alerting is a precondition for prod**, not a follow-up: every
office's retrieval runs on this cluster, and QdrantPeerDown is the only signal
of an outage before users notice. Staging runs without it, knowingly. Do not
build a metrics stack in this repository; connect one that exists:

- the provider's metrics stack (the cluster ships one that cannot be removed,
  which is why `installMetricsServer` is off): have it scrape
  `otel-collector.grid.svc.cluster.local:8889` (path `/metrics`) and load
  `qdrant.rules.yaml` from the `qdrant-alert-rules` ConfigMap as a rule group;
- or a `vmalert` (or Prometheus) beside it, with
  `-rule=/rules/qdrant.rules.yaml` from that ConfigMap mounted at `/rules`, its
  datasource a VictoriaMetrics/Prometheus that scrapes the same endpoint, and
  a notifier (Alertmanager) that reaches a person.

Either way the scraper's pod needs a NetworkPolicy allow to the collector's
port 8889 if it runs outside `grid`, and QdrantDiskHigh additionally needs the
kubelet's volume stats (`kubelet_volume_stats_*`), which the collector does
not scrape. Prove it works before prod depends on it: stop one peer on the
scratch stack (`kubectl -n grid delete pod qdrant-2`) and see QdrantPeerDown
reach a person.

| Alert | Fires when | Go to |
|---|---|---|
| QdrantPeerDown | a peer has not answered a scrape for 2 min | [Replace a failed peer](#replace-a-failed-peer) |
| QdrantDeadReplicas | a peer reports dead shard replicas for 5 min | [Replace a failed peer](#replace-a-failed-peer) |
| QdrantShardWithoutActiveReplica | some shard has no active replica | [Restore one shard](#restore-one-shard-every-replica-dead) |
| QdrantShardUnderReplicated | some shard has fewer than 2 active replicas for 15 min | [Replace a failed peer](#replace-a-failed-peer) |
| QdrantPendingRaftOperations | uncommitted consensus operations for 10 min | [Replace a failed peer](#replace-a-failed-peer) |
| QdrantConsensusStopped | a peer's consensus thread stopped | [Replace a failed peer](#replace-a-failed-peer) |
| QdrantMemoryHigh | resident memory above 80% of the limit for 10 min | [OOM crash loop](#oom-crash-loop) |
| QdrantQuotaExceeded | a peer refuses writes (507) over a quota | [Quotas](#quotas) |
| QdrantDiskHigh | a data PVC above 70% for 15 min (needs the kubelet's volume stats, which the collector does not scrape) | [Quotas](#quotas) |
| QdrantSearchLatencyHigh | p99 search on a peer above 500 ms for 10 min | [OOM crash loop](#oom-crash-loop) |
| QdrantMmapsNearLimit | memory maps above 80% of `vm.max_map_count` | [OOM crash loop](#oom-crash-loop) |
| QdrantRecoveryMode | a peer runs in recovery mode | [OOM crash loop](#oom-crash-loop) |
| QdrantSnapshotsStale | no snapshot on any peer for 26 h | [Restore from snapshots](#restore-from-snapshots) |

Drilled: the collector's export of three peers (482 series), and a Prometheus
3.5 loading the rendered file (`promtool check rules`: 13 rules) that took
QdrantPeerDown for `qdrant-2` to pending 46 s and firing 156 s after the peer
stopped, and cleared it about 60 s after it returned. A peer that is down
while nothing writes leaves `collection_dead_replicas` at 0: a replica is
marked Dead only when a write fails on it. **QdrantPeerDown is the alert that
sees an outage first.**

## Dashboard

Qdrant serves its own web UI at `/dashboard` on the REST port, 6333: the
collections, their points and payloads, a console for REST calls, and the
cluster view. The UI calls the REST API on its own origin, so whatever reaches
`/dashboard` must reach the whole port.

### When it is off, or on Compose

Port-forward to the Service and open it locally:

```bash
kubectl -n grid port-forward svc/qdrant 6333:6333
# then http://localhost:6333/dashboard
```

A port-forward enters the pod through the kubelet, so the NetworkPolicies do
not apply and no `qdrant-ops` pod is needed. It lands on one peer; on three
peers that peer forwards what it does not hold, so the dashboard shows the
whole cluster.

**Compose** has no gateway and runs Qdrant without a key, on the internal
network only. To look, publish the port on loopback for as long as you need it,
from `deploy/compose`:

```bash
printf 'services:\n  qdrant:\n    ports: ["127.0.0.1:6333:6333"]\n' > /tmp/qdrant-port.yaml
docker compose --env-file ../.env -f docker-compose.yaml -f /tmp/qdrant-port.yaml up -d qdrant
# http://localhost:6333/dashboard, no key; afterwards, unpublish it again:
docker compose --env-file ../.env -f docker-compose.yaml up -d qdrant
```

Never bind it to anything but `127.0.0.1`: without a key, anyone who reaches
the port can read and delete every collection. Both `up -d qdrant` calls
recreate the container, a few seconds of retrieval errors on the local stack.

### On a public host

The dashboard is at `https://qdrant.<baseDomain>` (`qdrantDashboardDomain`
overrides the host) behind the same edge gate as Langfuse: the platform WorkOS
Connect application, and the `platform:organizations:view` permission only.
Analysts holding `platform:observability:view` get Langfuse, not this.

It is **on by default** (`qdrantDashboardEnabled` defaults to `true`) on every
stack that has the three `otelOidc*` keys, which dev and prod both do. A stack
without them gets no route and a warning in `pulumi preview`; one that sets
the flag to `true` explicitly without them fails the plan. Per environment:

1. **WorkOS first, before the deploy that brings it.** Register
   `https://qdrant.<baseDomain>/oauth2/callback` as a redirect URI on the
   platform Connect application, the one Langfuse uses
   ([`kubernetes.md` §9](kubernetes.md#the-platform-connect-application)).
   Do not create a second application. Skip it and the login dies at WorkOS
   with `invalid_redirect_uri`; nothing else breaks.
2. **Nothing to set.** The flag is on by default. To keep a stack without the
   dashboard and port-forward instead:

   ```bash
   pulumi config set grid-oib:qdrantDashboardEnabled false
   ```

3. **DNS.** Nothing to do with `dnsEnabled`: the host's record follows the
   listener. A stack that keeps records by hand adds `qdrant.<baseDomain>` →
   the Envoy Gateway IP before the deploy, or the certificate never issues.
4. **Deploy** (`pulumi up`). It adds the `https-qdrant` listener and its
   `grid-qdrant-tls` certificate, the `grid-qdrant-dashboard` HTTPRoute, its
   `grid-qdrant-dashboard-auth` SecurityPolicy with the `qdrant-dashboard-oidc`
   Secret, and the `allow-edge-to-qdrant-dashboard` NetworkPolicy (the edge to
   6333, nothing else). `pulumi config set grid-oib:qdrantDashboardEnabled false`
   removes all of it again.

`https://qdrant.<baseDomain>/` redirects to `/dashboard`, through the WorkOS
login when there is no session.

**Undrilled**: no stack has served it yet. The manifests are held by
`deploy/pulumi/index-qdrant-dashboard.spec.ts`.

**Check it once after the first deploy.** The route strips `Authorization` and
`Cookie` before the request reaches Qdrant, so the WorkOS access token the
gate forwards never arrives there. That rests on Envoy applying route header
removal in its router filter, after the gate's filters, which was read in the
Envoy and Envoy Gateway sources but not watched on a running Gateway
(`deploy/pulumi/src/platform/qdrant-dashboard.ts` cites both). Signed in,
before you paste a key, open the browser's network tab: the dashboard's first
API call must answer `401` with `Must provide an API key or an Authorization
bearer token`. `Invalid API key or JWT` instead means a bearer token reached
Qdrant, and the strip is not working.

Then sign in as a user who holds neither platform permission (a tenant user):
the edge must answer `403 RBAC: access denied`. That is the open question
[`kubernetes.md` §9b](kubernetes.md#giving-analysts-read-only-access) step 3
records for the shared gate. If the user gets in, `pulumi config set
grid-oib:qdrantDashboardEnabled false` and deploy: Qdrant's key would still refuse
them every API call, but the host would be open to anyone with a WorkOS
account.

### Which key to paste

The edge injects no Qdrant key: the gate decides who reaches the dashboard,
and Qdrant's own key still decides what each call may do. The dashboard asks
for a key on its first call and keeps it in the browser. (A key set at the edge
would be a literal header value, in plaintext in the HTTPRoute and in Pulumi
state, and would make every operator an admin.)

- **To look, paste the read-only key.** Searches, scrolls, collection and
  cluster info all work with it, and nothing can be changed by accident:

  ```bash
  kubectl -n grid get secret qdrant-credentials -o jsonpath='{.data.read-only-api-key}' | base64 -d
  ```

- **The read-write key (`api-key`) only for a write you mean to make**:
  deleting or re-creating a collection, a snapshot, a shard move. Prefer the
  procedures in this runbook for those, which run from `qdrant-ops`. If you do
  paste it, clear it from the dashboard (or the site's storage in the browser)
  when you are done, so the next look is read-only again.

## Restore from snapshots

### What a snapshot holds

The `qdrant-snapshot` CronJob (daily, `qdrantSnapshotSchedule`) does two things:

1. It records `GET /aliases` as `aliases/aliases-YYYY-MM-DD-HH-MM-SS.json` in
   the bucket. Aliases live in consensus, not in any snapshot, and every
   client addresses the store through them.
2. On every peer, it snapshots every collection. A collection snapshot taken
   on a peer holds **that peer's shards only**. Qdrant uploads it as
   `qdrant/snapshots/<collection>/<collection>-<peer id>-<timestamp>.snapshot`
   (a peer holding none of a collection's shards uploads an 8 KB empty one).

Both expire after `qdrantSnapshotRetentionDays`. A shard snapshot you take by
hand (below) lands under `qdrant/snapshots/<collection>/shards/<id>/` and the
next pass expires it as well.

So the unit of restore is **(collection, peer)**: to restore a collection,
recover each peer's snapshot of it on some peer.

List the bucket:

```sh
s3 "$S3/qdrant-snapshots?list-type=2&prefix=qdrant/snapshots/piloti_office_v1/" | grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g'
s3 "$S3/qdrant-snapshots?list-type=2&prefix=aliases/" | grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g'
```

Take one now (before an upgrade, a rebuild, anything risky):

```bash
kubectl -n grid create job --from=cronjob/qdrant-snapshot qdrant-snapshot-manual-$(date +%s)
kubectl -n grid logs -f job/qdrant-snapshot-manual-<suffix>
```

**Qdrant fetches the snapshot itself.** With `snapshots_storage: s3`, a
recover takes an `http(s)` URL (`s3://` is refused: "scheme s3 is not
supported", and `file://` reads the peer's local disk). Hand it a presigned
GET URL for the object. Presigning is offline (nothing is contacted), so do it
anywhere with boto3, the backend image included, with the snapshot identity:

```bash
export S3_SECRET=$(kubectl -n grid get secret qdrant-credentials -o jsonpath='{.data.s3-secret-key}' | base64 -d)
presign() {  # presign <object key>  -> a URL valid for one hour, for the in-cluster endpoint
  uv run --no-project --with boto3 python -c '
import os, sys, boto3
from botocore.config import Config
s3 = boto3.client("s3", endpoint_url="http://seaweedfs:8333", aws_access_key_id="grid-qdrant",
                  aws_secret_access_key=os.environ["S3_SECRET"], region_name="us-east-1",
                  config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))
print(s3.generate_presigned_url("get_object", Params={"Bucket": "qdrant-snapshots", "Key": sys.argv[1]}, ExpiresIn=3600))' "$1"
}
```

The endpoint in the URL must be the one the peers resolve (the CronJob's
`S3_ENDPOINT`), not one you port-forwarded to.

### Restore one collection, peer by peer

For a collection that is gone or corrupt everywhere (dropped by mistake, a bad
migration), while the peers themselves are fine. **Drilled: `piloti_office_v1`
(6 shards, RF 2, 1,500 points) deleted, restored from three per-peer snapshots
in 28 s; counts per scope and a sampled point's text identical to before.**

1. Note the snapshot of each peer, newest first. Each name carries the id of
   the peer it was taken on; `q $P0/cluster` maps the ids to pods.
2. Recover each one on its own peer, `priority=snapshot` (the snapshot's data
   wins over whatever replicas exist). The first recover recreates the
   collection, with its config from the snapshot, cluster-wide:

   ```sh
   # For N in 0 1 2: KEY is that peer's snapshot, URL its presigned GET.
   q -X PUT -d "{\"location\":\"$URL\",\"priority\":\"snapshot\"}" "$P0/collections/piloti_office_v1/snapshots/recover?wait=true"
   q -X PUT -d "{\"location\":\"$URL1\",\"priority\":\"snapshot\"}" "$P1/collections/piloti_office_v1/snapshots/recover?wait=true"
   q -X PUT -d "{\"location\":\"$URL2\",\"priority\":\"snapshot\"}" "$P2/collections/piloti_office_v1/snapshots/recover?wait=true"
   ```

3. Restore the alias ([Restore the aliases](#restore-the-aliases)). Dropping a
   collection drops its aliases.
4. Trim the extra replicas. Each peer's recover adds its shards on that peer
   whether or not the new placement put them there, so some shards end with
   three replicas (in the drill: shards 1, 4 and 5). Find shards with more
   than two `Active` replicas across the three peers' `.../cluster` and drop
   one per shard, from the peer holding the most:

   ```sh
   q -X POST -d '{"drop_replica":{"shard_id":4,"peer_id":<peer id>}}' "$P0/collections/piloti_office_v1/cluster?wait=true"
   ```

5. Repair what the snapshot predates: writes after the snapshot are not in
   it, and with Chroma gone no other store holds them. Documents ingested,
   deleted or re-tagged since the snapshot must be ingested, deleted or
   re-tagged again; their files are still in the object store. Taking a manual
   snapshot before a risky step keeps that window short.

### Restore after losing every peer

Every pod and every PVC gone: a new, empty cluster with new peer ids, and the
bucket. **Drilled: three fresh peers bootstrapped in 8 s; `piloti_office_v1`
restored in 12.5 s and `piloti_corpus_v1` in 7.1 s by recovering old peer
`835…`'s snapshot on new `qdrant-0`, `100…`'s on `qdrant-1`, `294…`'s on
`qdrant-2`; counts identical on every peer.**

1. Bring the cluster up empty (the StatefulSet does this with new PVCs) and
   check `q $P0/cluster` shows three peers and `q $P0/collections` none.
2. For each collection, recover each old peer's latest snapshot on a
   different new peer, exactly as above. Any old snapshot may go to any new
   peer; what matters is that every old peer's snapshot is recovered once.
3. Restore the aliases, trim replicas above RF 2, and repair what the
   snapshot predates (step 5 above).

In the drill one shard ended with both replicas `Dead`: the host disk filled
while the recover's transfers ran. That is the next section.

### Restore one shard (every replica Dead)

A shard whose every replica is `Dead` (or `Partial` and stuck) serves nothing
and fails every write to it. If a peer still holds the shard's data, snapshot
that one shard there and recover it in place; Qdrant uploads the shard snapshot
to the bucket like any other. **Drilled: shard 0 of `piloti_office_v1`, both
replicas Dead after the disk filled; Active on both in 9.8 s, no points lost.**

```sh
q -X POST "$P1/collections/piloti_office_v1/shards/0/snapshots?wait=true"
# -> {"name":"piloti_office_v1-shard-0-2026-10-13-07-45-49.snapshot", ...}
# object: qdrant/snapshots/piloti_office_v1/shards/0/<that name>; presign it, then:
q -X PUT -d "{\"location\":\"$URL\",\"priority\":\"snapshot\"}" "$P1/collections/piloti_office_v1/shards/0/snapshots/recover?wait=true"
```

The other replica re-syncs from the recovered one by itself. If no peer holds
the shard's data any more, restore the whole collection from the nightly
snapshots instead (above): a collection snapshot cannot be recovered as one
shard.

### Restore the aliases

Take the newest record from the bucket and replay it. `create_alias` on a
name that exists moves it.

```sh
KEY=$(s3 "$S3/qdrant-snapshots?list-type=2&prefix=aliases/" | grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g' | sort | tail -1)
s3 "$S3/qdrant-snapshots/$KEY"
# {"result":{"aliases":[{"alias_name":"piloti_corpus","collection_name":"piloti_corpus_v1"},
#                       {"alias_name":"piloti_office","collection_name":"piloti_office_v1"}]},...}
q -X POST -d '{"actions":[
  {"create_alias":{"alias_name":"piloti_office","collection_name":"piloti_office_v1"}},
  {"create_alias":{"alias_name":"piloti_corpus","collection_name":"piloti_corpus_v1"}}]}' \
  "$P0/collections/aliases?wait=true"
```

Drilled in each restore above (one alias replayed in 0.2 s, searches through
the alias answered at once).

## Replace a failed peer

### Peer down, volume intact

A drain, a node reboot, a crash, a rolling update: the pod comes back on the
same PVC under the same id and catches up with consensus by itself. **Drilled:
`qdrant-1` stopped (SIGTERM) and started; ready again in 8 s; its Raft commit
equal to the leader's at once; `POST /cluster/recover` on it answered `true`
and changed nothing, as it should when nothing is behind.** Use
`q -X POST $P1/cluster/recover` only when a returning peer's `commit` stays
behind the leader's: it asks the leader for a consensus snapshot.

What it costs: the backend creates collections at `write_consistency_factor`
1 (`schema.WRITE_CONSISTENCY_FACTOR`), so writes keep succeeding on the
surviving replica, the missing replicas are marked Dead
(`collection_dead_replicas` > 0, and its alert fires), and the returning peer
recovers them by itself. **Drilled side by side: 300 points written during an
outage left the factor-1 collection at all 600.** A collection still at factor
2 (created before the change) behaves badly instead: every write touching a
shard with a replica on the missing peer fails (HTTP 500, "N out of 6 shards
failed to apply operation"), the parts of a batch that reached the surviving
replicas stay applied, nothing is marked Dead, and the returning peer's
replicas silently lack those writes (546 of 600 in the same drill). Move such a
collection to 1 with `q -X PATCH -d '{"params":{"write_consistency_factor":1}}'
"$P0/collections/<name>"`, and after
any outage it went through while ingestion ran, **resync the returning peer's
replicas** (next section). [`qdrant-retrieval-design.md`](../architecture/qdrant-retrieval-design.md)
§12 has the reasoning.

### Resync replicas after a peer outage

For each shard with a replica on the peer that was down (`STALE`), copy the
healthy replica to the peer holding none, then drop the stale one. The shard
keeps two replicas throughout. **Drilled: 6 shards in 19 s, exact count back to
what the surviving replicas held.**

```sh
# Find them: compare points_count of each shard across the three peers.
for P in $P0 $P1 $P2; do q $P/collections/piloti_office_v1/cluster; done
# For shard 3, healthy on <good>, stale on <stale>, absent from <spare>:
q -X POST -d '{"replicate_shard":{"shard_id":3,"from_peer_id":<good>,"to_peer_id":<spare>}}' "$P0/collections/piloti_office_v1/cluster"
q $P0/collections/piloti_office_v1/cluster | grep -o '"shard_transfers":\[[^]]*\]'   # until []
q -X POST -d '{"drop_replica":{"shard_id":3,"peer_id":<stale>}}' "$P0/collections/piloti_office_v1/cluster?wait=true"
```

This can leave the returning peer with fewer shards than the others;
[move some back](#add-a-node-and-move-shards). A write to the shard failed
while every replica was down, and its file failed where a person sees it:
retry those files.

### Peer and volume lost

The node is gone with its disk, or the PVC was deleted: the StatefulSet
recreates `qdrant-2` empty, and it **cannot start**. It panics with:

```
Can't initialize consensus: ... peer URI http://qdrant-2.qdrant-headless.grid:6335/ already used by
peer 586267661742201 which still has shards, remove its shards first or use a different URI
```

and the pod goes into CrashLoopBackOff. Reads keep working (RF 2); writes to
the shards it held fail as above. **Drilled end to end: removal of the dead
peer to the new peer Ready 10 s, to every shard back at RF 2 (five
`replicate_shard`) 18 s.**

1. Find the dead peer's id: the one whose URI is `qdrant-2...` in
   `q $P0/cluster`.
2. Remove it from consensus. `force=true` because it still holds shards; their
   other replicas are what you replicate from:

   ```sh
   q -X DELETE "$P0/cluster/peer/<dead peer id>?force=true"
   ```

3. Let the pod start (the next CrashLoopBackOff retry, or
   `kubectl -n grid delete pod qdrant-2`). It joins under a new id:
   `q $P2/cluster | grep -o '"peer_id":[0-9]*' | head -1`.
4. Re-replicate every shard now below two active replicas onto it, from the
   replica that survived, collection by collection:

   ```sh
   q -X POST -d '{"replicate_shard":{"shard_id":0,"from_peer_id":<survivor>,"to_peer_id":<new id>}}' "$P0/collections/piloti_office_v1/cluster"
   q -X POST -d '{"replicate_shard":{"shard_id":0,"from_peer_id":<survivor>,"to_peer_id":<new id>}}' "$P0/collections/piloti_corpus_v1/cluster"
   ```

   Wait for `shard_transfers` to be empty, then check every shard shows two
   `Active` replicas.
5. If the node is gone for good and the PVC is bound to it (local storage),
   delete the PVC before step 3 so the pod can be scheduled elsewhere:
   `kubectl -n grid delete pvc data-qdrant-2` (`Retain` keeps the volume
   itself; delete that separately when you are sure).

## Add a node and move shards

Open-source Qdrant does not rebalance. A new peer joins empty, and shards
move only when told to. `office` has 6 shards, which spread evenly over 1, 2,
3 or 6 peers. **Drilled: a fourth peer joined in 4 s; five `move_shard` in
17 s; scaling back to three (two moves off it, then removing it) 8 s; counts
unchanged throughout.**

1. Add the peer: `pulumi config set grid-oib:qdrantReplicas 4`, then a deploy.
   With `nodeGroupData` set, the required anti-affinity needs a fourth data
   node first.
2. Move shards onto it, one at a time, from the peers holding the most:

   ```sh
   q -X POST -d '{"move_shard":{"shard_id":0,"from_peer_id":<busy peer>,"to_peer_id":<new peer>}}' "$P0/collections/piloti_office_v1/cluster"
   q $P0/collections/piloti_office_v1/cluster | grep -o '"shard_transfers":\[[^]]*\]'   # until []
   ```

To scale down: move every shard off the highest-ordinal peer, remove it
(`q -X DELETE $P0/cluster/peer/<id>`, without `force`: it must hold nothing
by then), then lower `qdrantReplicas`. The StatefulSet removes the
highest ordinal, so empty that one; its PVC is `Retain`ed.

The corpus collection is created with RF 2 by the backend; the design wants
it on every peer (§9). Drilled in 4 s:

```sh
q -X POST -d '{"replicate_shard":{"shard_id":0,"from_peer_id":<holder>,"to_peer_id":<the peer without it>}}' "$P0/collections/piloti_corpus_v1/cluster"
q -X PATCH -d '{"params":{"replication_factor":3}}' "$P0/collections/piloti_corpus_v1"
```

## Rebuild a collection behind its alias

A different shard count or replication shape is a new collection: Qdrant
cannot reshard. `init_from` is no shortcut: 1.19.2 accepts it and ignores it
(drilled: the new collection stayed at 0 points). `scripts/qdrant_rebuild.py`
creates the next `_vN` in the live collection's shape (or the one you ask
for), copies every point with both stored vectors and its payload, and moves
the alias in one atomic request; the old collection stays, and switching back
is the rollback. It reads `QDRANT_URL` and `QDRANT_API_KEY`, which
every backend pod has. **Drilled: `piloti_office_v1` (6 shards) → `_v2` with 3
shards, RF 2 kept, 1,500 points in 8 s; switch and rollback, each instant.**

```bash
kubectl -n grid create job --from=cronjob/qdrant-snapshot qdrant-snapshot-pre-rebuild-$(date +%s)
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_rebuild.py office --copy-to piloti_office_v2 --shards 12
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_rebuild.py office --switch-to piloti_office_v2
# Rollback, any time while _v1 exists:
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_rebuild.py office --switch-to piloti_office_v1
```

Writes during the copy land in the old collection only, and with Chroma gone
nothing carries them over after the switch: stop ingestion for the copy, and
repeat any delete or fact change made while it ran. Drop
the old collection once you are sure: `q -X DELETE $P0/collections/piloti_office_v1`.
A copy of a large collection runs for a while: run it in a pod that survives
your terminal (`kubectl exec` dies with it).

### Tune BM25 to the chunks (and fill in the stemmed text) in the same rebuild

Every copy also tunes the keyword channel (ADR-0127). Qdrant's `qdrant/bm25`
weighs a term by the chunk's length against `avg_len`, default 256, counted in
its own tokens: the words left after the German analysis, about 0.30 per model
token on our text. A copy reads each chunk's length back out of the weights it
stored, and when the mean is more than 10 % from the live collection's
`avg_len` it creates the target with the measured mean (recorded in the
collection metadata as `bm25_length`) and recomputes every lexical vector
from the chunk text, server side; dense vectors are copied as stored. The same
copy gives every chunk written before the stemmed exact search existed its
`text_stem` field, which `knowledge_search(match="exact", stemmed=true)` needs
to find it in inflected form. **Drilled on a local 1.19.2 only; never run against
a deployment as part of the change that added it.**

Measured from the chunking constants, before any deployment was read: a
640-token section chunk is about 210 BM25 tokens, a full 1,024-token split about
310, a median 128-token OIB Punkt about 41. Expect the office collection near the
default and the corpus well below it. Read the real numbers first; nothing is
written:

```bash
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_chunk_length_stats.py
# office: 5000 chunks, mean …, p50 …, p90 …, written with {...}; a rebuild would write {...}
```

Then schedule it like any rebuild above (snapshot, stop ingestion, copy, check,
switch). The copy log says `BM25 length … (recomputed)` or `(copied as stored)`.
`--bm25-avg-len`, `--bm25-k` and `--bm25-b` set the values outright (a parity
sweep's result, `evals/oib-retrieval`); `--keep-bm25` copies the
lexical vectors untouched.

```bash
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_rebuild.py corpus --copy-to piloti_corpus_v2
kubectl -n grid exec deploy/aiq-api -- python scripts/qdrant_rebuild.py corpus --switch-to piloti_corpus_v2
kubectl -n grid rollout restart deploy/aiq-api deploy/ingest-worker
```

Every process reads a collection's BM25 length from its metadata and trusts it
for five minutes, so restart the backend and the ingest workers after the switch
(and after a rollback): a writer that still holds the old length would write
vectors the new collection does not expect. Gate it with the parity harness and
the answer suite (`--set loop` and `--set files`) before and after.

## Rename payload keys

The knowledge layer's payload keys were renamed to English
(`project_facts.federal_state`, `clause_id`, `guideline` ...). Reads accept
both spellings until the points are rewritten:
[`qdrant-payload-rename-runbook.md`](qdrant-payload-rename-runbook.md).

## OOM crash loop

A peer killed by the kernel while loading its segments restarts, loads again
and is killed again (`OOMKilled` in `kubectl -n grid describe pod qdrant-N`).
In order of preference:

1. **Raise the limit**: `qdrantMemory` (request = limit, so the node must have
   it free). The real fix whenever the node allows it.
2. **Load without making things resident**: `pulumi config set
   grid-oib:qdrantLowMemoryMode no_populate` (or `no_resident`, the milder),
   deploy, and once the peer is up and the cause is dealt with, `pulumi config
   rm grid-oib:qdrantLowMemoryMode` and deploy again. `no_resident` loads
   quantization, payload indexes and payload storage as on-disk; `no_populate`
   also skips prefaulting vectors, the HNSW graph and payloads. Searches are
   slower until it is removed. It sets the env on every peer and rolls them one
   at a time; if the rollout stalls behind the crash-looping pod, `kubectl -n
   grid delete pod qdrant-N` lets the controller replace it with the new spec.
3. While it is down, writes to its shards fail ([above](#peer-down-volume-intact));
   resync when it is back.

**Partly drilled:** `QDRANT__STORAGE__LOW_MEMORY_MODE` is read
(`GET /telemetry?details_level=1` on the peer reports
`"low_memory_mode":"no_populate"`), the peer serves reads in it, and an unknown
value stops the peer at start (`enum LowMemoryMode does not have variant
constructor bogus for key storage.low_memory_mode`, which is why the config
refuses one). The OOM itself was not reproduced: the drill's data fit in any
limit the host could set.

High p99 latency, memory near the limit and memory maps near
`vm.max_map_count` share causes: a collection grown past the node, an
optimisation running, a node shared with something else. `q $P0/telemetry`
shows optimisations; `collection_running_optimizations` on the collector's
export says the same per peer.

## Quotas

Every peer refuses writes once resident memory passes `qdrantQuotaMemoryPercent`
(90) of its limit or the data volume passes `qdrantQuotaDiskPercent` (85), with
HTTP 507 ("Insufficient storage: Disk usage is at 93% of total capacity,
exceeding the configured limit"), and reports `quota_exceeded{resource="memory"|"disk"}`
= 1. Reads keep working, and the ingest queue retries a refused write. A limit
reached must fall back by `release_margin_percent` (5) before writes resume.
**Drilled on one peer: the 507 and the metric, with the env Pulumi sets.**

```sh
q $P0/quotas    # {"config":{...},"usage":{"resident_memory_percent":..,"disk_usage_percent":..}}
```

Free space before raising a quota: grow the PVC (`kubectl -n grid patch pvc
data-qdrant-N -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'`,
where the storage class allows expansion), delete what is no longer needed
(an old `_vN` after a rebuild), or add a peer and move shards. Snapshots stage
on the same volume before upload, so a near-full disk also fails the snapshot
pass.

The quota values in the config **seed the quota manager on a cluster's first
start only**; after that Qdrant keeps them in consensus. To change them on a
running cluster, change the config (so a rebuilt cluster gets the same) and:

```sh
q -X PUT -d '{"enabled":true,"max_resident_memory_percent":90,"max_disk_usage_percent":88}' "$P0/quotas"
```

(undrilled: the `PUT /quotas` call; the seeding was drilled).

## Upgrade one minor at a time

**Undrilled**: no second Qdrant minor was available to the drill. Self-hosted
Qdrant cannot skip a minor, and a snapshot restores only into the same or the
next minor, so a failed upgrade is undone by restoring the snapshot taken
before it, on the old version.

1. Read the release notes of the next minor, and diff `deploy/pulumi/src/data/qdrant.ts` against
   `qdrant-helm` at that version (probes, the bootstrap script, new config).
2. If the notes change internal (p2p) authentication, the roll must run with
   `ENFORCE_INTERNAL_AUTH` off (remove it in `qdrantEnv` for this deploy and
   restore it in the next; there is deliberately no knob), or new and old peers
   refuse each other.
3. Snapshot: `kubectl -n grid create job --from=cronjob/qdrant-snapshot qdrant-snapshot-pre-upgrade-$(date +%s)`,
   and keep its objects past the retention window (copy them under another
   prefix in the bucket).
4. `pulumi config set grid-oib:qdrantImage qdrant/qdrant:v1.<next>.<patch>`,
   preview, deploy. The StatefulSet replaces one peer at a time, highest
   ordinal first, each Ready and 30 s soaked before the next.
5. After each peer: `curl -s $P2/ | head -c 200` reports its version;
   `q $P0/cluster` shows three peers and no `pending_operations`. After all:
   the counts and a search through the alias. Writes to a restarting peer's
   shards fail during each restart ([above](#peer-down-volume-intact)), so
   resync afterwards if ingestion ran.
6. Repeat for the next minor. Never two minors in one deploy.

What the drill did cover: nine rolling restarts with `ENFORCE_INTERNAL_AUTH` on
(the key rotation below), each peer back and in consensus in 5 to 7 s.

## Rotate the API key

Three deploys, because peers check the key on p2p too
(`ENFORCE_INTERNAL_AUTH`), and a peer restarted with only the new key would
refuse the others until they had it. `qdrantAltApiKey` is a second read-write
key every peer accepts while it is set. **Drilled with three rolling restarts
of all three peers: every write with the key the backends hold at that step
answered 200, the cluster stayed at three peers throughout, 57 s in all.**

```bash
NEW=$(openssl rand -base64 32)
# 1. Peers accept NEW as well. Backends keep sending OLD.
pulumi config set --secret grid-oib:qdrantAltApiKey "$NEW" && npm run up
# 2. Swap: NEW is the key, OLD the alternate. Peers and every backend tier roll;
#    a peer on either side of the roll accepts both.
OLD=$(pulumi config get grid-oib:qdrantApiKey)
pulumi config set --secret grid-oib:qdrantApiKey "$NEW"
pulumi config set --secret grid-oib:qdrantAltApiKey "$OLD" && npm run up
# 3. Retire OLD.
pulumi config rm grid-oib:qdrantAltApiKey && npm run up
```

Skipping step 2's alternate (going straight from 1 to "NEW, no alternate")
breaks the roll: a restarted peer sends NEW, but refuses OLD from the peers
not yet restarted. The snapshot CronJob reads the key from the Secret at each
run; the collector holds no key. The read-only key rotates in one deploy
(`qdrantReadOnlyApiKey`): nothing in the backend uses it yet.

## Chroma, retired

Every deployment has moved its vectors out of Chroma: production on
2026-10-18 (#1079: 11 collections, 52,280 chunks, none failed or out of step),
staging as well. The one-time machinery (the exporter, the importer, the
one-shot Kubernetes Job and its stack flag, the Compose switch that held the
base-corpus sync back during an import, and the deploy's vector-store floor)
was then removed. A stack that still sets the flag fails the plan with the
keys to `pulumi config rm`, like the other retired vector keys
(`RETIRED_VECTOR_KEYS` in `deploy/pulumi/src/config/qdrant.ts`). An
installation still on Chroma would take the procedure and the code from the
history, at the parent of the commit that removed them.

There is no way back to Chroma. A revert of ADR-0115 would bring back a store
that misses every write Qdrant has taken since the move. A backend image from
before the move, deployed by tag under today's program, has no Qdrant code: it
falls back to an empty per-pod store and loses every upload. Nothing checks for
that any more, so never roll back, on staging or prod, to a tag built before
2026-10-18.

## Drill log

Run 2026-10-13 by an agent, against Docker, not a cluster:

- **Shape**: three `qdrant/qdrant:v1.19.2` containers on one network, started
  in parallel with the exact bootstrap script and env Pulumi renders
  (`bootstrapScript`, `qdrantEnv`), uid 1000, read-only root with tmpfs where
  the pod has emptyDirs, DNS aliases equal to the headless names, keys and
  `ENFORCE_INTERNAL_AUTH` as in the pod; `chrislusf/seaweedfs:3.80` with the
  `grid-qdrant` identity; the CronJob's script run as rendered in
  `curlimages/curl:8.16.0` as uid 100; the pinned collector image with the
  rendered collector config; `prom/prometheus:v3.5.0` loading the rendered rules.
  Collections created and filled by the backend's own code
  (`ensure_collection`, `QdrantStore.upsert`; 1,500 office and 300 corpus
  points of 256 dimensions), the backfill and rebuild by the scripts in `scripts/`.
- **Differences**: the data directories were on tmpfs (the host disk was shared
  and nearly full), WAL segments were 2 MB and `default_segment_number` 1 to
  fit, each container had a 3 GB memory limit, the data was small, and
  there were no NetworkPolicies (Docker has none). Timings scale with data;
  the order of steps and every API call do not.

| Drill | Result |
|---|---|
| Bootstrap | three peers Ready in 2 to 9 s, one leader, `ENFORCE_INTERNAL_AUTH` on |
| Snapshot pass | 3 peers × 2 collections in 10.8 s; aliases recorded; objects as described above. With `RETENTION_DAYS=0`: every older snapshot, shard snapshot and alias record expired. An empty cluster: "no collections", exit 0 (before this change `names` ended in a `grep` that exits 1 on no match, which under `pipefail` read as "cannot list collections" and failed the Job) |
| Restore one collection | 28 s, counts and text identical, three replicas trimmed |
| Restore after losing every peer | fresh cluster 8 s, office 12.5 s, corpus 7.1 s |
| Restore one shard | 9.8 s from both replicas Dead to both Active |
| Peer down, volume intact | back in 8 s; writes failed while down; replicas diverged after |
| `write_consistency_factor` 1 vs 2 | 1: write succeeded, replicas marked Dead, self-healed, 600/600. 2: write failed, no Dead mark, 546/600 after return |
| Resync | 6 shards in 19 s |
| Peer and volume lost | replacement pod panics until the dead peer is removed; then Ready in 10 s, RF 2 in 18 s |
| Add / remove a node | join 4 s, five moves 17 s, scale-down 8 s |
| Rebuild behind the alias | `init_from` ignored; script: 1,500 points in 8 s, switch, verify, rollback |
| Backfill `--prune --verify` | 149 drifted points pruned, in step, exit 0, 6 s |
| Key rotation | three rolls, no failed write, 57 s |
| low_memory_mode | read, reported, served reads; bad value refused at start; OOM not reproduced |
| Quotas | 507 and `quota_exceeded{resource="disk"}` 1 |
| Metrics and alerts | keyless 6336 (200), 6333 without key (401); collector export 482 series; QdrantPeerDown pending 46 s, firing 156 s, cleared ~60 s after return |

**Not drilled**: the upgrade across a minor (no second minor available), an
actual OOM kill, `PUT /quotas` on a running cluster, NetworkPolicies (they
need a CNI), PVC expansion, and every step that needs a Kubernetes cluster:
the deploys of the flag flip, `kubectl` itself, and the StatefulSet's own
rolling update. The disk alert's kubelet series were not available to the
drill's Prometheus.

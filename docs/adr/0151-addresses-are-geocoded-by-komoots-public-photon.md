---
status: accepted
date: 2026-11-03
decision-makers: product owner
consulted: Platform
informed: everyone working in this repo
---

# Addresses are geocoded by komoot's public Photon instance

## Context and Problem Statement

The project dialog's address field suggests addresses through `GET /api/geocode`,
which asks a Photon geocoder (`apps/workspace/bff/geocoding/photon.ts`) at
`GEOCODER_URL`. ADR-0120 proposed running that Photon in the cluster, over the
Austrian OSM extract, and the Pulumi program carried the workload behind
`geocoderEnabled`, off by default.

No stack ever switched it on: no `deploy/pulumi/Pulumi.*.yaml` set the flag, so
no deployment had address search, and every person setting up a project typed
the address as plain text. The workload still cost something while it never
ran. Its pinned `eclipse-temurin:21.0.12.1_1-jre-noble` image failed the trivy
gate on develop (libbrotli1, CVE-2026-111497), which kept develop's CI red and
the staging deploy skipped. The product owner decided for a geocoder that needs
no account and costs nothing, and for no Java in the stack.

## Decision Drivers

* **Address search that works**, in every deployment, without a person
  switching it on per stack.
* **No account, no cost, no workload of ours.** The product owner's call.
* **Privacy.** A typed address is client data, and every keystroke-driven
  search is sent to the provider.
* **Austria only.** The product supports Austrian projects; hits from
  neighbouring countries are noise.
* **Fail open.** A geocoder that is slow, throttles or is gone must leave the
  dialog usable.

## Considered Options

1. komoot's public Photon instance, `https://photon.komoot.io`
2. Keep the self-hosted Photon of ADR-0120 and switch it on
3. A commercial API with a paid key (Google Places, HERE, Mapbox)
4. No address search (the state every deployment was in)

## Decision Outcome

Chosen option: 1, komoot's public instance, because it is the only option that
works today with no account, no cost and nothing to run, and the adapter,
specs and fixtures already speak its API (the fixtures were captured from it).

* `geocoderUrl` (Pulumi stack config) defaults to `https://photon.komoot.io` and
  reaches the frontend alone as `GEOCODER_URL`; empty switches address search
  off. Compose passes the same default.
* The adapter asks for Austria: `bbox=9.53,46.37,17.16,49.02` on every request,
  and every hit whose `countrycode` is not `AT` is dropped, because the box also
  covers parts of Germany, Switzerland, Italy, Slovenia, Hungary, Slovakia and
  the Czech Republic. A live query on 2026-11-03 for `Hauptplatz Passau` inside
  the box answered one German hit, and the parser returned none.
* The adapter names itself with a product-neutral `User-Agent`, as komoot's
  usage policy asks.
* The suggestion list shows "© OpenStreetMap contributors", which the ODbL asks
  for where its data is shown.
* The `geocoder` StatefulSet, its NetworkPolicy, its config keys, its constants
  and its image pins are deleted.

### Consequences

* Good, because address search is on in every deployment from the next deploy,
  and nothing in the cluster serves it.
* Good, because the Temurin and the geocoder's Alpine pins are gone, and with
  them the CVE that held develop red.
* Good, because the frontend reaches the instance over the open HTTPS egress it
  already has (`network-policies.ts` restricts ingress, not the frontend's
  egress), so no NetworkPolicy changes.
* Bad, because every address a person types leaves our cluster for komoot.
* Bad, because the public instance carries no SLA and throttles heavy use. A
  throttled or failed search answers no suggestions, and the typed line is kept
  as the address, as it is when no geocoder is configured.
* Bad, because the index is komoot's, refreshed on komoot's schedule.

### Confirmation

* `deploy/pulumi/index.spec.ts` asserts the frontend's `GEOCODER_URL` defaults
  to `https://photon.komoot.io`, that `bff-jobs` does not get it, and that no
  geocoder StatefulSet or NetworkPolicy exists.
* `deploy/pulumi/src/config.spec.ts` holds the default, empty as off, and a
  value that is no http(s) URL refused.
* `apps/workspace/bff/geocoding/photon.spec.ts` holds the Austrian box, the
  `countrycode` filter and the `User-Agent`; `app/api/geocode/route.spec.ts`
  holds the route's `enabled: false` when `GEOCODER_URL` is unset.
* `create-project-form.spec.tsx` holds the attribution line in the suggestion
  list.
* Nothing checks that komoot's instance is up or still answers in this format;
  a parser fed a changed response answers `[]`, which a person sees as "no
  suggestions".

## Pros and Cons of the Options

### 1. komoot's public Photon

* Good, because it needs no account, no key and no contract, and costs nothing.
* Good, because komoot is a German company (komoot GmbH, Potsdam), so the query
  stays in the EU and under the GDPR.
* Good, because it runs the Photon major the adapter was written against
  (1.x; its `/status` read 1.3.0 on 2026-10-20), and a live response parsed
  cleanly on 2026-11-03.
* Bad, because it has no SLA and throttles heavy use (komoot's
  [Photon README](https://github.com/komoot/photon)). Premise: the office count
  is small enough that keystroke searches stay under the throttle. A 429 in the
  frontend's `[geocode] photon answered` log line is the signal that it no
  longer holds.

### 2. Self-hosted Photon (ADR-0120)

* Good, because no address leaves the cluster.
* Bad, because the workload never ran: `geocoderEnabled` defaulted to false and
  no stack file set it, as of 2026-11-03. Premise: nobody was going to switch it
  on and own it. A team with an operator for it would change this.
* Bad, because what it cost bought nothing while it was off: a Java StatefulSet
  of 1.5 to 3 GiB, a 10Gi volume for a 1 GB index fetched from GraphHopper, and
  a JRE image whose CVEs (CVE-2026-84782 in October, CVE-2026-111497 in
  November) each blocked the trivy gate until the pin moved.
* Bad, because ADR-0120's privacy driver weighs less than it did there. Premise:
  the product already sends whole documents, drawings and contracts included,
  to EU model providers under zero data retention, and an address being typed is
  far less sensitive than those. Should the product stop sending documents out
  of the cluster, the driver weighs as it did in ADR-0120 again.

### 3. A commercial API with a paid key

* Good, because it comes with an SLA and quotas that can be bought up.
* Bad, because it needs an account, a key and a bill, which the product owner
  ruled out for now. Premise: the free instance suffices. Throttling is the
  trigger to revisit, and Google Places is the first candidate.
* Bad, because the large providers are mostly US processors.

### 4. No address search

* Good, because nothing is sent anywhere.
* Bad, because the person types the address and the Bundesland is left for the
  documents to supply or the review to ask, which is the gap ADR-0120 set out to
  close.

## More Information

Revisit when:

* the frontend logs `[geocode] photon answered 429` (or 403) more than now and
  then: komoot is throttling us. Move to a paid key (Google Places) or back to a
  self-hosted Photon, by setting `geocoderUrl`; the adapter takes any Photon.
* komoot changes the instance's terms, or the response format moves (a Photon
  2.x on the public instance).
* the product stops sending documents to external model providers, which
  removes the premise that an address is the lesser disclosure.

Supersedes [ADR-0120](0120-addresses-are-geocoded-by-a-self-hosted-photon.md).
The deleted workload is in the history of `deploy/pulumi/src/data/geocoder.ts`.

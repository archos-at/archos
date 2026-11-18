# syntax=docker/dockerfile:1
#
# The image the dev cluster's CI runners run (ADR-0184): GitHub's runner image plus what CI's
# jobs take from `ubuntu-latest`, a job container or `sudo`, since these runners have no Docker
# daemon and no root. tests/test_ci_toolchain_pins.py holds every version below to the one CI and
# production use. Built by .github/workflows/ci-runner-image.yml; the scale set runs it by digest.

FROM zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS gitleaks
FROM aquasec/trivy:0.61.1@sha256:91bcccab7cb503127b0d792db7c652c4e556c9ff30eeb0908b6ae1980d7727ad AS trivy
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS bun

FROM ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807

USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Production's Postgres major (CloudNativePG), for the throwaway clusters scripts/rls-test-db.sh
# builds. Ubuntu 24.04 ships 16, so from the PGDG repository.
ARG POSTGRES_MAJOR=17
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils build-essential \
      git git-lfs jq zstd unzip zip file locales tzdata rsync openssh-client \
      python3 python3-venv python3-pip eatmydata \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-${POSTGRES_MAJOR}" \
 && rm -rf /var/lib/apt/lists/*

RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Python and Node where actions/setup-python and actions/setup-node look before downloading,
# task and Bun where setup-task and setup-bun look. A pin that moves past these only makes a
# job download again.
ARG PYTHON_VERSION=3.14.10
ARG PYTHON_BUILD=40336797752
ARG PYTHON_SHA256=d67d217db8480fd474bac19db80f6b956362432cca30ed6ac6fbe5a2bba6b4cd
RUN curl -fsSL -o /tmp/python.tar.gz "https://github.com/actions/python-versions/releases/download/${PYTHON_VERSION}-${PYTHON_BUILD}/python-${PYTHON_VERSION}-linux-24.04-x64.tar.gz" \
 && echo "${PYTHON_SHA256}  /tmp/python.tar.gz" | sha256sum -c - \
 && install -d /tmp/python && tar -xzf /tmp/python.tar.gz -C /tmp/python \
 && (cd /tmp/python && RUNNER_TOOL_CACHE=/opt/hostedtoolcache bash ./setup.sh) \
 && rm -rf /tmp/python /tmp/python.tar.gz /root/.cache

ARG NODE_VERSION=22.23.4
ARG NODE_SHA256=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
RUN curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && install -d "/opt/hostedtoolcache/node/${NODE_VERSION}/x64" \
 && tar -xJf /tmp/node.tar.xz -C "/opt/hostedtoolcache/node/${NODE_VERSION}/x64" --strip-components=1 \
 && touch "/opt/hostedtoolcache/node/${NODE_VERSION}/x64.complete" \
 && rm /tmp/node.tar.xz
ENV PATH=/opt/hostedtoolcache/node/${NODE_VERSION}/x64/bin:${PATH}

ARG TASK_VERSION=3.52.0
ARG TASK_SHA256=02c679ffae53dca791804847d78b31731615894e292948397c971c87ac9e95bd
RUN curl -fsSL -o /tmp/task.tar.gz "https://github.com/go-task/task/releases/download/v${TASK_VERSION}/task_linux_amd64.tar.gz" \
 && echo "${TASK_SHA256}  /tmp/task.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/task.tar.gz -C /usr/local/bin task \
 && rm /tmp/task.tar.gz

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx \
 && [ "$(task --version)" = "${TASK_VERSION}" ] && [ "$(bun --version)" = 1.4.3 ]

# What CI otherwise installs with sudo (Chromium's libraries for the website's accessibility
# gate) or runs as a container (Semgrep, the scanners, Qdrant).
ARG PLAYWRIGHT_VERSION=1.63.0
RUN npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium && rm -rf /root/.npm /var/lib/apt/lists/*

ARG SEMGREP_VERSION=1.177.0
RUN python3 -m venv /opt/semgrep \
 && /opt/semgrep/bin/pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}" \
 && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep

ARG QDRANT_VERSION=1.19.2
ARG QDRANT_SHA256=34a788a09a4cb278b5c6d2af96d9a6db30c8c7e88ae3550455f7a4d425bb8d4b
RUN curl -fsSL -o /tmp/qdrant.tar.gz "https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-gnu.tar.gz" \
 && echo "${QDRANT_SHA256}  /tmp/qdrant.tar.gz" | sha256sum -c - \
 && install -d "/opt/qdrant/${QDRANT_VERSION}" \
 && tar -xzf /tmp/qdrant.tar.gz -C "/opt/qdrant/${QDRANT_VERSION}" qdrant \
 && rm /tmp/qdrant.tar.gz

COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
ENV NPM_CONFIG_PREFIX=/home/runner/.npm-global
ENV PATH=/home/runner/.npm-global/bin:/usr/lib/postgresql/${POSTGRES_MAJOR}/bin:${PATH}
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache
RUN install -d -o runner -g runner /home/runner/.npm-global \
 && chown -R runner:runner /opt/hostedtoolcache

USER runner

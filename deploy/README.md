# Deployment

Everything runs as Portainer stacks on the Docker host, deployed only by
GitHub Actions. The base domain is never written down in this repository — it
comes from the `HESBAH_BASE_DOMAIN` GitHub variable, and `<base-domain>` below
means that value.

| | Trigger | Portainer stack | Compose file | URL |
|---|---|---|---|---|
| Production | push to `main` | `hesbah` | `compose/prod.yml` | `https://<base-domain>` |
| Development | push to `develop` | `hesbah-dev` | `compose/env.yml` | `https://dev.<base-domain>` |
| Preview | open/update a PR | `hesbah-pr-<n>` | `compose/env.yml` | `https://pr-<n>.<base-domain>` |
| Shared non-prod | bootstrap script | `hesbah-nonprod` | `compose/nonprod-shared.yml` | — |

Dev and previews run from the **same compose file**, differing only in their
`ENV_*` values. That is deliberate: every preview is a rehearsal of the dev
deploy, and the dev deploy is a rehearsal of production's.

## How a request reaches an environment

```
*.<base-domain>  ──►  host:5174  ──►  preview-router  ──►  hesbah-dev-web-1
                                          (nginx)     └─►  hesbah-pr-<n>-web-1
  <base-domain>  ──►  host:5175  ──►  hesbah-web-1    (production, not routed)
```

`preview-router` lives in the shared `hesbah-nonprod` stack and needs no
per-environment configuration at all. It matches on the **subdomain** —
`dev.` or `pr-<n>.` — and turns it into a container name, which Docker's
embedded DNS resolves on the shared `hesbah-preview-net` network. Portainer names a
stack's containers deterministically (stack `hesbah-pr-123` → container
`hesbah-pr-123-web-1`), so the hostname alone determines the upstream.

Consequences worth knowing:

* **The parent domain appears nowhere in the router.** Moving to a new domain
  is one change at the edge and one GitHub variable — nothing in this repo.
* **The stack name is load-bearing.** Renaming `hesbah-pr-<n>` silently breaks
  routing.
* **No Docker socket is mounted.** The socket is root-equivalent on the host;
  a label-discovery router would need it and this design never does.
* A hostname with no environment behind it answers `503` with an explanation,
  not a bare gateway error.

Inside each environment, `web` (nginx) serves the SPA and proxies `/api/` and
`/health` to the API container, so a deployed environment is single-origin and
CORS never applies.

### Why the API service is called `backend`

Docker adds the **service name** as a network alias on every network a
container joins. Every environment attaches to the shared `hesbah-preview-net`, so a
service named `api` would make `api` resolve to N different containers there —
and `frontend/nginx.conf` proxies to the literal name `api:8080`. One PR's
frontend could reach another PR's API.

So in `compose/env.yml` the service is `backend`, and `api` is attached as an
alias **only** on the stack's private `default` network. Each `web` finds
exactly one `api` — its own — and finds no `api` at all on the shared network.

## The pipeline

```
pull request        → review.yml           backend build + smoke tests, frontend lint/typecheck/build, both images build
                    → preview.yml          build pr-<n>-<sha> images, deploy hesbah-pr-<n>, comment the URL
pull request closed → preview-teardown.yml destroy the stack, drop its database, prune its images
push to develop     → deploy-dev.yml       review → build → deploy → health gate → prune
push to main        → deploy-prod.yml      review → build → deploy → health gate → prune
push of a v* tag    → build.yml            publish an immutable release image; deploys nothing
```

`review.yml` and `build.yml` are reusable workflows called by both deploys, so
nothing reaches an environment that would have failed on the pull request.

Images go to `ghcr.io/<owner>/hesbah-api` and `ghcr.io/<owner>/hesbah-web`,
tagged with the 7-character commit SHA (previews: `pr-<n>-<sha>`). A deploy
always names an exact tag, never `latest`.

## Rolling back

Run **Deploy — development** or **Deploy — production** from the Actions tab
with `image_tag` set to a previously good short SHA. That path skips review and
rebuilds nothing — the image already exists and already passed review on its
way in.

Published tags: `https://github.com/<owner>/hesbah/pkgs/container/hesbah-api`.
A rolled-back tag may have been pruned from the host; that is fine, because the
deploy pulls it from GHCR again.

## One-time setup

### 1. Bootstrap the shared non-production stack

```bash
export PORTAINER_URL=https://portainer.example.com
export PORTAINER_TOKEN=…
deploy/scripts/bootstrap-nonprod.sh
```

Creates the `hesbah-preview-net` network and deploys `preview-router` + `preview-db`.
Safe to re-run.

### 2. Point the edge reverse proxy at the host

```
*.<base-domain>  ->  http://<docker-host>:5174    dev + PR previews
  <base-domain>  ->  http://<docker-host>:5175    production
```

Both forwarding `X-Forwarded-Proto: https`. The wildcard matches subdomains
only, not the apex, which is why production has its own vhost. A wildcard TLS
certificate for `*.<base-domain>` covers every preview that will ever exist.

### 3. Give Portainer a GHCR registry credential

A token that can read packages, otherwise a private image cannot be pulled at
deploy time. The host itself holds no GHCR credentials — Portainer injects
them, which is why `docker pull` on the host fails while a stack deploy works.

### 4. GitHub configuration

**Repository variables** (Settings → Secrets and variables → Actions →
Variables):

| Name | Required | Notes |
|---|---|---|
| `HESBAH_BASE_DOMAIN` | **yes** | e.g. `hesbah.example.com`. The only value with no default — the deploys fail fast without it. |
| `PORTAINER_ENDPOINT_ID` | no | Needed only when Portainer has more than one endpoint. |
| `PORTAINER_INSECURE` | no | `1` if Portainer is behind a self-signed certificate. Default `0`. |
| `PROD_WEB_PORT` | no | Default `5175`. Not 5173 — that port is already used by another project on the target host. |
| `PROD_DB_NAME` / `PROD_DB_USER` | no | Default `greenmarket` / `greenmarket_app`. |

**Repository secrets**:

| Name | Required | Notes |
|---|---|---|
| `PORTAINER_URL` | **yes** | e.g. `https://portainer.example.com`, no trailing slash. |
| `PORTAINER_TOKEN` | **yes** | Portainer API access token, sent as `X-API-Key`. |
| `NONPROD_POSTGRES_USER` | no | Default `postgres`. |
| `NONPROD_POSTGRES_PASSWORD` | no | Default `ChangeMe_DevOnly!` — the same value `docker-compose.yml` uses locally. |
| `PREVIEW_SECRET_SEED` | no | Seeds the derived per-environment JWT keys. Without it those keys are computable from this repository — fine for non-production, and the reason production never derives one. |

**Environment secrets** — create the `development`, `preview` and `production`
Environments. Production is the natural place for a required reviewer: the
deploy job then waits for approval after the image is built and before
anything on the host changes.

| Environment | Secret | Required | Notes |
|---|---|---|---|
| `production` | `JWT_SIGNING_KEY` | **yes** | See below. |
| `production` | `POSTGRES_PASSWORD` | no, but | Defaults to `ChangeMe_DevOnly!`, which is published in this repository. The deploy warns on every run until it is set. |
| `development` | `DEV_JWT_SIGNING_KEY` | no | Unset derives a stable key for dev. |

### Defaults, and the one that cannot exist

Everything falls back to the value `docker-compose.yml` already uses locally,
so the pipeline works on a fresh clone with almost nothing configured. Unset
secrets are written into the stack environment as empty values, and Compose's
`${VAR:-default}` treats empty as unset.

`JWT_SIGNING_KEY` is the exception, and it is the application's rule, not this
pipeline's: `Program.cs` refuses to start outside Development on a key shorter
than 32 characters or containing `CHANGE_ME` — which is exactly what
`docker-compose.yml` falls back to. Inheriting it would deploy a crash loop and
report it seven minutes later as a health-gate timeout. So:

* **dev and previews** get a key *derived* per environment (`sha256(seed:id:jwt)`).
  Derived rather than random so a redeploy does not sign testers out, and
  distinct per environment so a token minted in a preview is worthless
  against dev or production.
* **production** refuses to deploy without a real one. A key derived from
  anything in this repository is a key anyone can recompute, and that means
  anyone can mint a valid admin token.

## Preview teardown

Closing a pull request runs `preview-teardown.yml`, which does three things in
order:

1. **Destroys the `hesbah-pr-<n>` stack** — the containers.
2. **Drops `hesbah_pr_<n>`** from the shared Postgres, via a one-shot
   `hesbah-pr-<n>-reap` stack that is itself deleted straight afterwards. The
   container refuses any database name that is not `hesbah_pr_*`, so a
   mistyped PR number cannot drop dev.
3. **Prunes the images** this project pushed that no container references.
   This is where the pipeline creates the most garbage: it is every *push* to
   an open PR that builds another image pair, and none of them is ever
   deployed again once the PR closes.

Step 3 is `continue-on-error`: a teardown that reclaimed the containers and
the database but not the images has still done the part that matters.

The prune is host-wide in scope but narrow in what it deletes — only images
under this repository's GHCR prefix, only when no container (running *or*
stopped) references them, plus dangling layers. Another project's images on the
same host are never candidates, and the live dev and production containers keep
their own images off the list by being containers.

## Why the stack environment lives in the workflow

`portainer.sh` **replaces** the stack's entire environment on every deploy, so
a value typed into Portainer's UI by hand survives only until the next merge.
That is deliberate — it makes the workflow the single description of what is
running — but new configuration has to be added to the `Compose stack
environment` step, not to Portainer.

## The health gate

`portainer.sh` does not report success when Portainer accepts the stack.
Portainer returns as soon as it has *accepted* it, before Compose has torn the
old containers down, so polling immediately gets a 200 from the *outgoing*
container. The script waits out the swap, then requires three consecutive
`200`s from the public `/health` URL — a container that boots, throws, and is
restarted by Docker answers 200 intermittently, and a single lucky probe would
call that a successful deploy.

`/health` is served by the API (`Program.cs`) and proxied by nginx as its own
`location`. That block matters: without it the request falls through to the SPA
rule, answers `index.html` with a 200, and every deploy goes green even when
the API is dead.

## Running the scripts by hand

```bash
export PORTAINER_URL=https://portainer.example.com
export PORTAINER_TOKEN=…
deploy/scripts/portainer.sh status  hesbah
deploy/scripts/portainer.sh destroy hesbah-pr-42
deploy/scripts/portainer.sh prune   ghcr.io/<owner>/hesbah
```
